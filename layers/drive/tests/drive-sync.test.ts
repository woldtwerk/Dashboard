import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, openSqlite } from '../../core/server/db/client'
import { loadMigrations, runMigrations } from '../../core/server/db/migrate'
import { DRIVE_CRAWL_REFRESH_MS } from '../shared/sync-schedule'
import type { DriveEntry } from '../shared/types/drive'
import { DRIVE_MY_FILES_ROOT, DRIVE_SHARED_ROOT, DRIVE_TRASH_ROOT } from '../shared/drive-path'
import { driveCacheSchema } from '../server/db/cache'
import { driveEntries, driveFolders } from '../server/db/cache-schema'
import { diffListing, shouldDescend } from '../server/drive-sync/listing'
import { nextDueFolder, recordDriveListing } from '../server/utils/drive-sync'
import type { DriveCacheDb } from '../server/utils/drive-sync'

const migrationsDir = fileURLToPath(new URL('../server/db/cache-migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

const entry = (path: string, overrides: Partial<DriveEntry> = {}): DriveEntry => ({
  uid: path,
  name: path.split('/').at(-1) ?? path,
  type: 'file',
  parent: path.slice(0, path.lastIndexOf('/')),
  path,
  ...overrides
})

const folder = (path: string, parent = path.slice(0, path.lastIndexOf('/'))): DriveEntry =>
  entry(path, { type: 'folder', parent })

describe('diffListing', () => {
  it('reports added and changed entries and removes what the folder no longer lists', () => {
    const diff = diffListing(
      [entry('/a'), entry('/b'), entry('/c'), entry('/d')],
      [entry('/a'), entry('/b', { size: 1 }), entry('/d'), entry('/e')]
    )

    expect(diff.upsert.map(item => item.path)).toEqual(['/b', '/e'])
    expect(diff.removed).toEqual(['/c'])
  })
})

describe('shouldDescend', () => {
  it.each([
    [`${DRIVE_MY_FILES_ROOT}/folder`, true],
    [`${DRIVE_SHARED_ROOT}/folder`, true],
    [DRIVE_TRASH_ROOT, false],
    [`${DRIVE_TRASH_ROOT}/deleted`, false]
  ])('walks into %s: %s', (path, expected) => {
    expect(shouldDescend(path)).toBe(expected)
  })
})

describe('recordDriveListing', () => {
  let directory: string
  let sqlite: ReturnType<typeof openSqlite>
  let db: DriveCacheDb

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'allmight-drive-'))
    sqlite = openSqlite(join(directory, 'drive.sqlite'))
    runMigrations(sqlite, await loadMigrations(readMigration))
    db = createDatabase(sqlite, driveCacheSchema)
  })

  beforeEach(async () => {
    await db.delete(driveEntries)
    await db.delete(driveFolders)
  })

  afterAll(async () => {
    sqlite.close()
    await rm(directory, { recursive: true, force: true })
  })

  const storedEntries = async () =>
    (await db.select({ path: driveEntries.path }).from(driveEntries).where(eq(driveEntries.service, 'svc')))
      .map(row => row.path).sort()

  const storedFolders = async () =>
    (await db.select({ path: driveFolders.path }).from(driveFolders).where(eq(driveFolders.service, 'svc')))
      .map(row => row.path).sort()

  it('removes a deleted folder with its descendants but keeps siblings that share the prefix', async () => {
    const top = [
      folder('/my-files/a'),
      folder('/my-files/a b'),
      folder('/my-files/ab'),
      folder('/my-files/100%'),
      folder('/my-files/under_score')
    ]

    await recordDriveListing('svc', '/my-files', top, db)
    await recordDriveListing('svc', '/my-files/a', [folder('/my-files/a/child')], db)
    await recordDriveListing('svc', '/my-files/a/child', [entry('/my-files/a/child/deep.txt')], db)
    await recordDriveListing('svc', '/my-files/a b', [folder('/my-files/a b/x')], db)
    await recordDriveListing('svc', '/my-files/ab', [entry('/my-files/ab/file.txt')], db)

    await recordDriveListing('svc', '/my-files', top.filter(item => item.path !== '/my-files/a'), db)

    expect(await storedEntries()).toEqual([
      '/my-files/100%',
      '/my-files/a b',
      '/my-files/a b/x',
      '/my-files/ab',
      '/my-files/ab/file.txt',
      '/my-files/under_score'
    ])
    expect(await storedFolders()).toEqual([
      '/my-files',
      '/my-files/100%',
      '/my-files/a b',
      '/my-files/a b/x',
      '/my-files/ab',
      '/my-files/under_score'
    ])
  })

  it('makes a new child folder due and marks it listed after it is crawled', async () => {
    await recordDriveListing('svc', '/my-files', [folder('/my-files/new'), entry('/my-files/file.txt')], db)

    const due = await db.select().from(driveFolders).where(eq(driveFolders.path, '/my-files/new')).get()
    expect(due?.listedAt).toBeNull()

    await recordDriveListing('svc', '/my-files/new', [], db)

    const listed = await db.select().from(driveFolders).where(eq(driveFolders.path, '/my-files/new')).get()
    expect(listed?.listedAt).toBeInstanceOf(Date)

    const files = await db.select().from(driveFolders).where(eq(driveFolders.path, '/my-files/file.txt'))
    expect(files).toEqual([])
  })
})

describe('nextDueFolder', () => {
  let directory: string
  let sqlite: ReturnType<typeof openSqlite>
  let db: DriveCacheDb

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'allmight-drive-'))
    sqlite = openSqlite(join(directory, 'drive.sqlite'))
    runMigrations(sqlite, await loadMigrations(readMigration))
    db = createDatabase(sqlite, driveCacheSchema)
  })

  beforeEach(async () => {
    await db.delete(driveFolders)
  })

  afterAll(async () => {
    sqlite.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('returns a never-listed folder first, then the oldest past the refresh window, then nothing', async () => {
    const now = Date.now()

    await db.insert(driveFolders).values([
      { service: 'svc', path: '/my-files/fresh', listedAt: new Date(now), error: null },
      { service: 'svc', path: '/my-files/edge', listedAt: new Date(now - DRIVE_CRAWL_REFRESH_MS), error: null },
      { service: 'svc', path: '/my-files/old', listedAt: new Date(now - DRIVE_CRAWL_REFRESH_MS - 1_000), error: null },
      { service: 'svc', path: '/my-files/older', listedAt: new Date(now - DRIVE_CRAWL_REFRESH_MS - 5_000), error: null },
      { service: 'svc', path: '/my-files/never', listedAt: null, error: null }
    ])

    expect(await nextDueFolder('svc', now, db)).toBe('/my-files/never')

    await db.update(driveFolders).set({ listedAt: new Date(now) }).where(eq(driveFolders.path, '/my-files/never'))
    expect(await nextDueFolder('svc', now, db)).toBe('/my-files/older')

    await db.update(driveFolders).set({ listedAt: new Date(now) })
      .where(eq(driveFolders.service, 'svc'))
    expect(await nextDueFolder('svc', now, db)).toBeUndefined()
  })
})
