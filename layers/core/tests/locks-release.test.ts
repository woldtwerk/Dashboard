import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, openSqlite } from '../server/db/client'
import type { Database } from '../server/db/client'
import { loadMigrations, runMigrations } from '../server/db/migrate'
import { acquireLock, releaseLock } from '../server/db/locks'
import { isLockHeld, releaseHeldLocks, withLock } from '../server/utils/locks'

// Keep a handle on the real release, so the test can count the shutdown calls
vi.mock('../server/db/locks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/db/locks')>()
  return { ...actual, releaseLock: vi.fn(actual.releaseLock) }
})

const migrationsDir = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

describe('releaseHeldLocks', () => {
  let directory: string
  let sqlite: ReturnType<typeof openSqlite>
  let db: Database

  beforeEach(async () => {
    // Tests keep their database in a temp directory; .data is never touched
    directory = await mkdtemp(join(tmpdir(), 'allmight-locks-'))
    process.env.NUXT_DATABASE_PATH = join(directory, 'allmight.sqlite')
    sqlite = openSqlite(process.env.NUXT_DATABASE_PATH)
    runMigrations(sqlite, await loadMigrations(readMigration))
    db = createDatabase(sqlite)

    vi.stubGlobal('useDb', async () => db)
  })

  afterEach(async () => {
    sqlite.close()
    vi.unstubAllGlobals()
    delete process.env.NUXT_DATABASE_PATH
    await rm(directory, { recursive: true, force: true })
  })

  it('releases the leases this worker still holds', async () => {
    await withLock('sync', 60_000, async () => {
      expect(await isLockHeld('sync')).toBe(true)

      await releaseHeldLocks()

      expect(await isLockHeld('sync')).toBe(false)
    })
  })

  it('leaves a lease held by another owner untouched', async () => {
    expect(await acquireLock(db, 'other', 60_000, 'other-worker')).toEqual({ name: 'other', owner: 'other-worker' })

    await withLock('sync', 60_000, async () => {
      await releaseHeldLocks()
    })

    expect(await isLockHeld('sync')).toBe(false)
    expect(await isLockHeld('other')).toBe(true)
  })

  it('stops tracking a lease that was released normally', async () => {
    await withLock('sync', 60_000, async () => {})
    expect(await isLockHeld('sync')).toBe(false)

    vi.mocked(releaseLock).mockClear()
    await releaseHeldLocks()

    expect(releaseLock).not.toHaveBeenCalled()
  })
})
