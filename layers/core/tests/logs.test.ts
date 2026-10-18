import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { desc } from 'drizzle-orm'
import { createDatabase, enableWal, openSqlite } from '../server/db/client'
import { loadMigrations, runMigrations } from '../server/db/migrate'
import * as logsSchema from '../server/db/logs-schema'
import { logEntries, syncRuns } from '../server/db/logs-schema'
import { buildActivityDays, median } from '../server/logs/activity'
import { formatSseLog, maskSecrets, toLogEntry } from '../server/logs/entry'
import { matchesLogFilter, parseLogQuery } from '../server/logs/query'
import { createLogsStore } from '../server/logs/store'
import type { LogsDatabase } from '../server/logs/store'
import { cacheDbPath } from '../server/utils/cache-path'
import type { LogEntry, SyncRun } from '../shared/types/logs'

const migrationsDir = fileURLToPath(new URL('../server/db/logs-migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

function entry(at: string, level: LogEntry['level'] = 'info', domain = 'mail'): Omit<LogEntry, 'id'> {
  return { at, level, domain, service: 'service-1', message: `${level} line` }
}

function run(startedAt: string, durationMs: number, domain = 'mail'): SyncRun {
  return { domain, service: 'service-1', startedAt, durationMs, ok: true, changed: 1 }
}

describe('toLogEntry', () => {
  it('takes the message from strings and the first object as meta', () => {
    const result = toLogEntry({
      type: 'info',
      level: 3,
      date: new Date('2026-10-18T10:00:00.000Z'),
      args: ['Sync started', { durationMs: 5 }]
    }, 'mail', 'service-1')

    expect(result).toEqual({
      at: '2026-10-18T10:00:00.000Z',
      level: 'info',
      domain: 'mail',
      service: 'service-1',
      message: 'Sync started',
      meta: { durationMs: 5 }
    })
  })

  it('uses an Error message and supports a domain-wide line', () => {
    const result = toLogEntry({
      type: 'error',
      date: new Date('2026-10-18T10:00:00.000Z'),
      args: [new Error('provider is down')]
    }, 'calendar')

    expect(result).toEqual({
      at: '2026-10-18T10:00:00.000Z',
      level: 'error',
      domain: 'calendar',
      message: 'provider is down'
    })
  })

  it('maps consola types onto the four stored levels', () => {
    const level = (type: string) => toLogEntry({ type }, 'mail').level

    expect(['fatal', 'error'].map(level)).toEqual(['error', 'error'])
    expect(level('warn')).toBe('warn')
    expect(['info', 'log', 'success', 'start', 'ready', 'box'].map(level)).toEqual(Array(6).fill('info'))
    expect(['debug', 'trace'].map(level)).toEqual(['debug', 'debug'])
  })
})

describe('maskSecrets', () => {
  it('masks secret keys, Bearer values and nested copies', () => {
    const masked = maskSecrets({
      password: 'hunter2',
      nested: { apiKey: 'abc', token: 'Bearer abc.def', note: 'Bearer abc.def', list: [{ secret: 's' }] }
    }) as Record<string, unknown>

    expect(masked.password).toBe('***')
    expect(masked.nested).toEqual({ apiKey: '***', token: '***', note: '***', list: [{ secret: '***' }] })
  })

  it('bounds depth and array length', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 'secret' } } } } } } }
    const masked = maskSecrets(deep) as Record<string, unknown>

    expect(JSON.stringify(masked)).not.toContain('secret')
    expect(JSON.stringify(masked)).toContain('…')
    expect((maskSecrets(Array.from({ length: 100 }, (_, index) => index)) as unknown[]).length).toBe(50)
  })

  it('keeps the serialized meta under 4 KB with a truncation marker', () => {
    const masked = maskSecrets({ text: 'x'.repeat(10_000) }) as { truncated: boolean, preview: string }

    expect(masked.truncated).toBe(true)
    expect(masked.preview.endsWith('…')).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(masked)).length).toBeLessThanOrEqual(4 * 1024)
  })
})

describe('parseLogQuery', () => {
  it('parses comma lists, pagination and the default limit', () => {
    expect(parseLogQuery({ domains: 'mail,calendar', levels: 'warn,error', before: '42', limit: '10' })).toEqual({
      domains: ['mail', 'calendar'],
      services: undefined,
      levels: ['warn', 'error'],
      before: 42,
      limit: 10
    })

    expect(parseLogQuery({}).limit).toBe(100)
  })

  it('rejects unknown levels, bad ids and out-of-range paging', () => {
    expect(() => parseLogQuery({ levels: 'verbose' })).toThrow()
    expect(() => parseLogQuery({ domains: 'Mail' })).toThrow()
    expect(() => parseLogQuery({ before: '0' })).toThrow()
    expect(() => parseLogQuery({ limit: '501' })).toThrow()
  })

  it('filters by level, domain and service', () => {
    const item: LogEntry = { id: 1, at: '2026-10-18T10:00:00.000Z', level: 'warn', domain: 'mail', service: 's1', message: 'x' }

    expect(matchesLogFilter(item, {})).toBe(true)
    expect(matchesLogFilter(item, { levels: ['warn'] })).toBe(true)
    expect(matchesLogFilter(item, { levels: ['error'] })).toBe(false)
    expect(matchesLogFilter(item, { domains: ['calendar'] })).toBe(false)
    expect(matchesLogFilter(item, { services: ['s1'] })).toBe(true)
  })
})

describe('formatSseLog', () => {
  it('wraps the entry as a named SSE data line', () => {
    const item: LogEntry = { id: 7, at: '2026-10-18T10:00:00.000Z', level: 'info', domain: 'core', message: 'hello' }

    expect(formatSseLog(item)).toEqual({ event: 'log', data: JSON.stringify(item) })
  })
})

describe('activity', () => {
  it('computes the median of odd and even lists', () => {
    expect(median([])).toBeNull()
    expect(median([3])).toBe(3)
    expect(median([30, 10, 20])).toBe(20)
    expect(median([10, 20, 30, 40])).toBe(25)
  })

  it('groups warn/error lines and sync runs per UTC day and domain', () => {
    const days = buildActivityDays(
      [
        { at: new Date('2026-10-18T01:00:00.000Z'), level: 'warn', domain: 'mail' },
        { at: new Date('2026-10-18T02:00:00.000Z'), level: 'error', domain: 'mail' },
        { at: new Date('2026-10-17T23:00:00.000Z'), level: 'warn', domain: 'mail' }
      ],
      [
        { startedAt: new Date('2026-10-18T03:00:00.000Z'), domain: 'mail', durationMs: 10 },
        { startedAt: new Date('2026-10-18T04:00:00.000Z'), domain: 'mail', durationMs: 30 }
      ]
    )

    expect(days).toEqual([
      { date: '2026-10-17', domain: 'mail', warnings: 1, errors: 0, syncRuns: 0, medianSyncMs: null },
      { date: '2026-10-18', domain: 'mail', warnings: 1, errors: 1, syncRuns: 2, medianSyncMs: 20 }
    ])
  })
})

describe('logs store', () => {
  let dir: string
  let sqlite: DatabaseSync
  let db: LogsDatabase

  beforeEach(async () => {
    // Tests keep their cache in a temp directory; .data is never touched
    dir = await mkdtemp(join(tmpdir(), 'allmight-logs-'))
    process.env.NUXT_CACHE_DIR = dir

    sqlite = openSqlite(cacheDbPath(dir, 'logs'))
    await enableWal(sqlite)
    runMigrations(sqlite, await loadMigrations(readMigration))
    db = createDatabase(sqlite, logsSchema)
  })

  afterEach(async () => {
    sqlite.close()
    delete process.env.NUXT_CACHE_DIR
    await rm(dir, { recursive: true, force: true })
  })

  it('flushes the queue after one second in one transaction', async () => {
    vi.useFakeTimers()
    const published: LogEntry[] = []
    const store = createLogsStore(db, {
      retentionDays: 7,
      maxEntries: 100,
      publish: (item) => {
        published.push(item)
      }
    })

    try {
      store.enqueue(entry('2026-10-18T10:00:00.000Z'))
      store.enqueue(entry('2026-10-18T10:00:01.000Z', 'warn'))

      expect(await db.select().from(logEntries)).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1_000)
      await store.flush()
    } finally {
      vi.useRealTimers()
    }

    const rows = await db.select().from(logEntries).orderBy(logEntries.id)
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.level)).toEqual(['info', 'warn'])
    expect(published.map(item => item.id)).toEqual(rows.map(row => row.id))
  })

  it('flushes right away at 100 entries', async () => {
    const store = createLogsStore(db, { retentionDays: 7, maxEntries: 500 })

    const start = new Date('2026-10-18T10:00:00.000Z').getTime()
    for (let index = 0; index < 100; index++) {
      store.enqueue(entry(new Date(start + index * 1_000).toISOString()))
    }

    await store.flush()

    expect(await db.select().from(logEntries)).toHaveLength(100)
  })

  it('queries newest first with filters and id pagination', async () => {
    const store = createLogsStore(db, { retentionDays: 7, maxEntries: 100 })

    store.enqueue(entry('2026-10-18T10:00:00.000Z'))
    store.enqueue(entry('2026-10-18T10:00:01.000Z', 'error'))
    store.enqueue(entry('2026-10-18T10:00:02.000Z', 'warn', 'calendar'))
    await store.flush()

    const newest = await store.query({})
    expect(newest.map(item => item.domain)).toEqual(['calendar', 'mail', 'mail'])
    expect((await store.query({ before: newest[1]!.id })).map(item => item.domain)).toEqual(['mail'])
    expect((await store.query({ levels: ['warn', 'error'] })).map(item => item.level)).toEqual(['warn', 'error'])
    expect((await store.query({ domains: ['mail'] })).map(item => item.level)).toEqual(['error', 'info'])
  })

  it('prunes by age, entry count and sync-run age', async () => {
    const store = createLogsStore(db, { retentionDays: 7, maxEntries: 2 })

    store.enqueue(entry('2026-10-18T10:00:00.000Z'))
    store.enqueue(entry('2026-10-18T10:00:01.000Z'))
    store.enqueue(entry('2026-10-18T10:00:02.000Z'))
    store.enqueue(entry('2026-10-01T10:00:00.000Z'))
    await store.flush()

    await store.recordSyncRun(run('2026-09-01T10:00:00.000Z', 10))
    await store.recordSyncRun(run('2026-10-18T10:00:00.000Z', 20))

    await store.prune(new Date('2026-10-18T12:00:00.000Z'))

    const rows = await db.select().from(logEntries).orderBy(desc(logEntries.id))
    expect(rows.map(row => row.at.toISOString())).toEqual(['2026-10-18T10:00:02.000Z', '2026-10-18T10:00:01.000Z'])
    expect(await db.select().from(syncRuns)).toHaveLength(1)
  })

  it('aggregates activity from stored lines and runs', async () => {
    const store = createLogsStore(db, { retentionDays: 7, maxEntries: 100 })

    store.enqueue(entry('2026-10-18T10:00:00.000Z', 'warn'))
    store.enqueue(entry('2026-10-18T11:00:00.000Z', 'error'))
    await store.flush()
    await store.recordSyncRun(run('2026-10-18T12:00:00.000Z', 40))

    expect(await store.activity(14, new Date('2026-10-18T13:00:00.000Z'))).toEqual([
      { date: '2026-10-18', domain: 'mail', warnings: 1, errors: 1, syncRuns: 1, medianSyncMs: 40 }
    ])
  })

  it('remembers the last prune across the worker', async () => {
    const store = createLogsStore(db, { retentionDays: 7, maxEntries: 100 })

    expect(await store.getState('lastPrunedAt')).toBeUndefined()
    await store.setState('lastPrunedAt', '123')
    expect(await store.getState('lastPrunedAt')).toBe('123')
  })
})
