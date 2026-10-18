import { and, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import type { ActivityDay } from '../../shared/types/dashboard'
import type { LogEntry, LogLevel, LogQuery, SyncRun } from '../../shared/types/logs'
import type * as logsSchema from '../db/logs-schema'
import { logEntries, logsState, syncRuns } from '../db/logs-schema'
import { buildActivityDays } from './activity'

export type LogsDatabase = SqliteRemoteDatabase<typeof logsSchema>

export interface LogsStoreOptions {
  /** Drop entries older than this; also the hard limit enforced by `prune` */
  retentionDays: number
  /** Keep at most this many entries */
  maxEntries: number
  /** Called once a batch was written, so the live stream sees the stored ids */
  publish?: (entry: LogEntry) => void | Promise<void>
  /** Runs after a batch was written, e.g. to trigger the hourly prune */
  onFlush?: () => void | Promise<void>
}

export interface LogsStore {
  /** Buffers an entry; never waits and never throws */
  enqueue: (entry: Omit<LogEntry, 'id'>) => void
  /** Writes everything buffered so far in one transaction */
  flush: () => Promise<void>
  recordSyncRun: (run: SyncRun) => Promise<void>
  prune: (now?: Date) => Promise<void>
  query: (query: LogQuery) => Promise<LogEntry[]>
  activity: (days: number, now?: Date) => Promise<ActivityDay[]>
  getState: (key: string) => Promise<string | undefined>
  setState: (key: string, value: string) => Promise<void>
  close: () => Promise<void>
}

const FLUSH_INTERVAL_MS = 1_000
const FLUSH_BATCH_SIZE = 100
const DAY_MS = 24 * 60 * 60 * 1_000
const SYNC_RUN_RETENTION_DAYS = 30

function toRow(entry: Omit<LogEntry, 'id'>) {
  return {
    at: new Date(entry.at),
    level: entry.level,
    domain: entry.domain,
    service: entry.service ?? null,
    message: entry.message,
    meta: entry.meta ? JSON.stringify(entry.meta) : null
  }
}

function toEntry(row: typeof logEntries.$inferSelect): LogEntry {
  const entry: LogEntry = {
    id: row.id,
    at: row.at.toISOString(),
    level: row.level as LogLevel,
    domain: row.domain,
    message: row.message
  }

  if (row.service) {
    entry.service = row.service
  }
  if (row.meta) {
    try {
      entry.meta = JSON.parse(row.meta) as Record<string, unknown>
    } catch {
      // A row written by an older version may not be JSON; keep the line
    }
  }

  return entry
}

/**
 * Buffered writer for the logs cache. Entries are queued in memory per worker and
 * flushed in one transaction, so a chatty sync does not turn into one SQLite
 * write per line. A persistence failure is reported to the console and never
 * reaches the caller that logged.
 */
export function createLogsStore(db: LogsDatabase, options: LogsStoreOptions): LogsStore {
  const queue: Omit<LogEntry, 'id'>[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let writes: Promise<unknown> = Promise.resolve()
  let closed = false

  function clearTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  async function persist(batch: Omit<LogEntry, 'id'>[]) {
    try {
      const rows = await db.transaction(async tx => tx.insert(logEntries)
        .values(batch.map(toRow))
        .returning())

      for (const row of rows) {
        const entry = toEntry(row)
        try {
          await options.publish?.(entry)
        } catch (error) {
          console.error('[logs] Could not publish a log entry:', error)
        }
      }
    } catch (error) {
      // The entry still went to the console; losing the cache copy must not fail the caller
      console.error(`[logs] Could not persist ${batch.length} log entries:`, error)
    }

    // Never await post-flush work: pruning writes through the same queue, so
    // waiting here would wait on the very flush that called it.
    if (options.onFlush) {
      const onFlush = options.onFlush
      void Promise.resolve()
        .then(() => onFlush())
        .catch(error => console.error('[logs] Post-flush work failed:', error))
    }
  }

  function flush(): Promise<void> {
    clearTimer()

    const batch = queue.splice(0)
    if (!batch.length) {
      return writes.then(() => undefined, () => undefined)
    }

    // One write at a time on the worker's single SQLite connection
    const run = writes.catch(() => {}).then(() => persist(batch))
    writes = run

    return run.then(() => undefined, () => undefined)
  }

  function schedule() {
    if (timer || closed) {
      return
    }

    timer = setTimeout(() => {
      timer = undefined
      void flush()
    }, FLUSH_INTERVAL_MS)
    timer.unref?.()
  }

  function enqueue(entry: Omit<LogEntry, 'id'>) {
    if (closed) {
      console.warn('[logs] The logs store is closed; the entry was only printed')
      return
    }

    queue.push(entry)

    if (queue.length >= FLUSH_BATCH_SIZE) {
      void flush()
    } else {
      schedule()
    }
  }

  async function settle() {
    await writes.catch(() => {})
  }

  return {
    enqueue,
    flush,
    close() {
      closed = true
      return flush()
    },

    async recordSyncRun(run) {
      const task = writes.catch(() => {}).then(() => db.insert(syncRuns).values({
        domain: run.domain,
        service: run.service,
        startedAt: new Date(run.startedAt),
        durationMs: run.durationMs,
        ok: run.ok,
        changed: run.changed
      }))
      writes = task

      try {
        await task
      } catch (error) {
        console.error('[logs] Could not record a sync run:', error)
      }
    },

    async prune(now = new Date()) {
      const task = writes.catch(() => {}).then(async () => {
        const entryCutoff = new Date(now.getTime() - options.retentionDays * DAY_MS)
        const runCutoff = new Date(now.getTime() - SYNC_RUN_RETENTION_DAYS * DAY_MS)

        await db.transaction(async (tx) => {
          await tx.delete(logEntries).where(lt(logEntries.at, entryCutoff))
          await tx.delete(syncRuns).where(lt(syncRuns.startedAt, runCutoff))

          // The id just past the newest `maxEntries` rows is the first one to drop
          const oldestKept = await tx.select({ id: logEntries.id }).from(logEntries)
            .orderBy(desc(logEntries.id))
            .limit(1)
            .offset(Math.max(0, options.maxEntries))
            .get()

          if (oldestKept) {
            await tx.delete(logEntries).where(lte(logEntries.id, oldestKept.id))
          }
        })
      })
      writes = task

      try {
        await task
      } catch (error) {
        console.error('[logs] Could not prune the logs cache:', error)
      }
    },

    async query(query) {
      await settle()

      const conditions = []
      if (query.domains?.length) {
        conditions.push(inArray(logEntries.domain, query.domains))
      }
      if (query.services?.length) {
        conditions.push(inArray(logEntries.service, query.services))
      }
      if (query.levels?.length) {
        conditions.push(inArray(logEntries.level, query.levels))
      }
      if (query.before) {
        conditions.push(lt(logEntries.id, query.before))
      }

      const rows = await db.select().from(logEntries)
        .where(and(...conditions))
        .orderBy(desc(logEntries.id))
        .limit(query.limit ?? 100)

      return rows.map(toEntry)
    },

    async activity(days, now = new Date()) {
      await settle()

      // The window starts at the beginning of the UTC day, `days - 1` days back
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      start.setUTCDate(start.getUTCDate() - (days - 1))

      const [entries, runs] = await Promise.all([
        db.select({ at: logEntries.at, level: logEntries.level, domain: logEntries.domain })
          .from(logEntries)
          .where(and(gte(logEntries.at, start), inArray(logEntries.level, ['warn', 'error']))),
        db.select({ startedAt: syncRuns.startedAt, domain: syncRuns.domain, durationMs: syncRuns.durationMs })
          .from(syncRuns)
          .where(gte(syncRuns.startedAt, start))
      ])

      return buildActivityDays(
        entries.map(entry => ({ ...entry, level: entry.level as LogLevel })),
        runs
      )
    },

    async getState(key) {
      await settle()
      const row = await db.select({ value: logsState.value }).from(logsState).where(eq(logsState.key, key)).get()
      return row?.value
    },

    async setState(key, value) {
      const task = writes.catch(() => {}).then(() => db.insert(logsState)
        .values({ key, value })
        .onConflictDoUpdate({ target: logsState.key, set: { value } }))
      writes = task
      await task
    }
  }
}
