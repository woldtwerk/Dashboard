import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, openSqlite, retryWhileBusy } from '../server/db/client'
import type { Database } from '../server/db/client'
import { loadMigrations, runMigrations } from '../server/db/migrate'
import type { Migration } from '../server/db/migrate'
import { deleteService, findService, findServices, upsertService } from '../server/db/service-repository'
import { acquireLock, isLocked, releaseLock, renewLock } from '../server/db/locks'

const migrationsDir = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

const service = (id: string, domain = 'mail') => ({ id, connector: 'proton', domain, name: id, icon: null, settings: 'encrypted' })

describe('retryWhileBusy', () => {
  const busy = () => Object.assign(new Error('database is locked'), { errstr: 'database is locked' })

  it('retries while the database is locked', async () => {
    let calls = 0
    const result = await retryWhileBusy(() => {
      if (++calls < 3) throw busy()
      return 'done'
    })

    expect(result).toBe('done')
    expect(calls).toBe(3)
  })

  it('rethrows other errors right away', async () => {
    let calls = 0
    await expect(retryWhileBusy(() => {
      calls++
      throw new Error('syntax error')
    })).rejects.toThrow('syntax error')
    expect(calls).toBe(1)
  })

  it('gives up after the last attempt', async () => {
    await expect(retryWhileBusy(() => {
      throw busy()
    }, 2)).rejects.toThrow('database is locked')
  })
})

describe('migrations', () => {
  it('applies the bundled migrations once', async () => {
    const sqlite = openSqlite(':memory:')
    const migrations = await loadMigrations(readMigration)

    expect(runMigrations(sqlite, migrations)).toEqual(migrations.map(migration => migration.tag))
    expect(runMigrations(sqlite, migrations)).toEqual([])
    expect(sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: migrations.length })
  })

  it('only applies migrations newer than the last applied one', () => {
    const sqlite = openSqlite(':memory:')
    const first: Migration = { tag: '0000_a', folderMillis: 1, hash: 'a', statements: ['CREATE TABLE a (id integer)'] }
    const second: Migration = { tag: '0001_b', folderMillis: 2, hash: 'b', statements: ['CREATE TABLE b (id integer)'] }

    expect(runMigrations(sqlite, [first])).toEqual(['0000_a'])
    expect(runMigrations(sqlite, [second, first])).toEqual(['0001_b'])
  })

  it('rolls back a failing migration completely', () => {
    const sqlite = openSqlite(':memory:')
    const broken: Migration = { tag: '0000_broken', folderMillis: 1, hash: 'x', statements: ['CREATE TABLE a (id integer)', 'NOT SQL'] }

    expect(() => runMigrations(sqlite, [broken])).toThrow()
    expect(sqlite.prepare('SELECT name FROM sqlite_master WHERE name = \'a\'').get()).toBeUndefined()
  })
})

describe('service repository', () => {
  let db: Database

  beforeEach(async () => {
    const sqlite = openSqlite(':memory:')
    runMigrations(sqlite, await loadMigrations(readMigration))
    db = createDatabase(sqlite)
  })

  it('stores and reads services', async () => {
    await upsertService(db, service('a'))

    expect(await findService(db, 'a')).toMatchObject({ id: 'a', connector: 'proton', domain: 'mail', icon: null })
    expect((await findService(db, 'a'))?.createdAt).toBeInstanceOf(Date)
    expect(await findService(db, 'missing')).toBeUndefined()
  })

  it('lists services in creation order, optionally by domain', async () => {
    await upsertService(db, service('a'))
    await upsertService(db, service('b', 'calendar'))
    await upsertService(db, service('c'))

    expect((await findServices(db)).map(row => row.id)).toEqual(['a', 'b', 'c'])
    expect((await findServices(db, 'mail')).map(row => row.id)).toEqual(['a', 'c'])
  })

  it('updates a service and keeps its creation date', async () => {
    const created = await upsertService(db, service('a'))
    const updated = await upsertService(db, { ...service('a'), name: 'Renamed', settings: 'new' })

    expect(updated).toMatchObject({ name: 'Renamed', settings: 'new' })
    expect(updated.createdAt).toEqual(created.createdAt)
    expect(await findServices(db)).toHaveLength(1)
  })

  it('deletes a service', async () => {
    await upsertService(db, service('a'))

    expect(await deleteService(db, 'a')).toMatchObject({ id: 'a', domain: 'mail' })
    expect(await deleteService(db, 'a')).toBeUndefined()
    expect(await findServices(db)).toEqual([])
  })
})

describe('locks', () => {
  let db: Database

  beforeEach(async () => {
    const sqlite = openSqlite(':memory:')
    runMigrations(sqlite, await loadMigrations(readMigration))
    db = createDatabase(sqlite)
  })

  it('grants a free lock and refuses a held one', async () => {
    const first = await acquireLock(db, 'sync', 60_000, 'worker-1')

    expect(first).toEqual({ name: 'sync', owner: 'worker-1' })
    expect(await acquireLock(db, 'sync', 60_000, 'worker-2')).toBeUndefined()
    expect(await isLocked(db, 'sync')).toBe(true)
  })

  it('takes over an expired lock', async () => {
    await acquireLock(db, 'sync', -1, 'worker-1')

    expect(await isLocked(db, 'sync')).toBe(false)
    expect(await acquireLock(db, 'sync', 60_000, 'worker-2')).toEqual({ name: 'sync', owner: 'worker-2' })
  })

  it('renews and releases only for the owner', async () => {
    const lock = (await acquireLock(db, 'sync', 60_000, 'worker-1'))!

    expect(await renewLock(db, { name: 'sync', owner: 'worker-2' }, 60_000)).toBe(false)
    expect(await renewLock(db, lock, 60_000)).toBe(true)

    await releaseLock(db, { name: 'sync', owner: 'worker-2' })
    expect(await isLocked(db, 'sync')).toBe(true)

    await releaseLock(db, lock)
    expect(await isLocked(db, 'sync')).toBe(false)
  })
})
