import { consola, LogLevels } from 'consola'
import type { ConsolaInstance, ConsolaReporter } from 'consola'
import type { SyncRun } from '../../shared/types/logs'
import * as logsSchema from '../db/logs-schema'
import { errorText, toLogEntry } from '../logs/entry'
import { createLogsStore } from '../logs/store'
import type { LogsStore } from '../logs/store'
import { publishToChannel } from './domain-events'

const PRUNE_LOCK = 'logs-prune'
// Deleting tens of thousands of rows may take a while; the lease outlives it
const PRUNE_LOCK_TTL_MS = 5 * 60_000
const PRUNE_INTERVAL_MS = 60 * 60 * 1_000
/** One lock attempt per worker a minute is enough; the stored timestamp decides cluster-wide */
const PRUNE_ATTEMPT_MS = 60_000
const STATE_KEY = 'lastPrunedAt'

let storePromise: Promise<LogsStore> | undefined
let lastPruneAttempt = 0

function configLevel(level: string): number {
  return level in LogLevels ? LogLevels[level as keyof typeof LogLevels] : LogLevels.info
}

function logsStore(): Promise<LogsStore> {
  if (!storePromise) {
    const created = (async () => {
      const config = useRuntimeConfig().logs
      const db = await useCacheDb('logs', logsSchema)

      return createLogsStore(db, {
        retentionDays: config.retentionDays,
        maxEntries: config.maxEntries,
        publish: entry => publishToChannel('logs', entry),
        onFlush: () => pruneIfDue()
      })
    })()

    storePromise = created.catch((error) => {
      storePromise = undefined
      throw error
    })
  }

  return storePromise
}

/**
 * At most one prune an hour cluster-wide. The lease keeps two workers from
 * pruning at once; the timestamp in the logs database keeps them from doing it
 * again after the lease expired.
 */
async function pruneIfDue(): Promise<void> {
  if (Date.now() - lastPruneAttempt < PRUNE_ATTEMPT_MS) {
    return
  }
  lastPruneAttempt = Date.now()

  try {
    await withLock(PRUNE_LOCK, PRUNE_LOCK_TTL_MS, async () => {
      const store = await logsStore()
      const last = Number(await store.getState(STATE_KEY) ?? 0)

      if (last && Date.now() - last < PRUNE_INTERVAL_MS) {
        return
      }

      await pruneLogs()
      await store.setState(STATE_KEY, String(Date.now()))
    })
  } catch (error) {
    console.error('[logs] Pruning failed:', error)
  }
}

/** Drops entries older than the retention window and all but the newest `maxEntries`. */
export async function pruneLogs(): Promise<void> {
  const store = await logsStore()
  await store.prune()
}

/**
 * The one logger of a domain or service. Console output stays consola's own;
 * an extra reporter persists and streams every line at or above the configured
 * level (`runtimeConfig.logs.level`, `NUXT_LOGS_LEVEL`).
 */
export function useServiceLogger(domain: string, service?: string): ConsolaInstance {
  const level = configLevel(useRuntimeConfig().logs.level)
  const logger = consola.create({ level }).withTag(service ? `${domain}:${service}` : domain)

  const reporter: ConsolaReporter = {
    log(logObject) {
      if ((logObject.level ?? 0) > level) {
        return
      }

      try {
        const entry = toLogEntry({
          type: logObject.type,
          level: logObject.level,
          date: logObject.date,
          args: logObject.args,
          message: logObject.message
        }, domain, service)

        // The write buffer owns ordering; a broken logs cache must not fail the caller
        void logsStore()
          .then(store => store.enqueue(entry))
          .catch((error) => {
            console.error('[logs] Could not queue a log entry:', error)
          })
      } catch (error) {
        console.error('[logs] Could not format a log entry:', error)
      }
    }
  }

  logger.addReporter(reporter)

  return logger
}

/** The worker's logs store, shared by the logger, the query API and the stream. */
export async function useLogsStore(): Promise<LogsStore> {
  return await logsStore()
}

/** Writes everything buffered by this worker. Called on Nitro shutdown. */
export async function flushLogs(): Promise<void> {
  if (!storePromise) {
    return
  }

  try {
    await (await logsStore()).flush()
  } catch (error) {
    console.error('[logs] Could not flush the logs cache:', error)
  }
}

/** Records one finished sync; never throws into the sync that produced it. */
export async function recordSyncRun(run: SyncRun): Promise<void> {
  try {
    await (await logsStore()).recordSyncRun(run)
  } catch (error) {
    console.error('[logs] Could not record a sync run:', error)
  }
}

/**
 * Runs a connector's connection test and logs a failure as a warning with the
 * service id when it is known. The error itself is rethrown, so the wizard still
 * receives it.
 */
export async function runLoggedTest(domain: string, serviceId: string | undefined, action: string, test: () => Promise<void>): Promise<void> {
  try {
    await test()
  } catch (error) {
    useServiceLogger(domain, serviceId).warn(action, { error: errorText(error) })
    throw error
  }
}
