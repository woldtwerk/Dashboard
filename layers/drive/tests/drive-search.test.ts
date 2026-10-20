import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, openSqlite } from '../../core/server/db/client'
import { loadMigrations, runMigrations } from '../../core/server/db/migrate'
import type { DriveEntry } from '../shared/types/drive'
import { driveCacheSchema } from '../server/db/cache'
import { driveEntries, driveFolders } from '../server/db/cache-schema'
import { normalizeSearchText, searchParentLabel } from '../server/drive-sync/search'
import { searchDriveEntries } from '../server/utils/drive-search'
import { recordDriveListing } from '../server/utils/drive-sync'
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

describe('normalizeSearchText', () => {
  it.each([
    ['Übersicht', 'ubersicht'],
    ['Café au lait', 'cafe au lait'],
    ['STRASSE', 'strasse']
  ])('folds %s to %s', (text, expected) => {
    expect(normalizeSearchText(text)).toBe(expected)
  })
})

describe('searchParentLabel', () => {
  it.each([
    ['/my-files', '/'],
    ['/my-files/Public/2026', '/Public/2026'],
    ['/shared-with-me', 'Shared'],
    ['/shared-with-me/Team', 'Shared/Team']
  ])('labels %s as %s', (parent, expected) => {
    expect(searchParentLabel(parent)).toBe(expected)
  })
})

describe('searchDriveEntries', () => {
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

  it('requires every term to match the name', async () => {
    await recordDriveListing('svc', '/my-files', [
      entry('/my-files/Quarterly Report.pdf'),
      entry('/my-files/Quarterly Notes.pdf'),
      entry('/my-files/Annual Report.pdf')
    ], db)

    const hits = await searchDriveEntries(['svc'], 'quarterly report', 10, db)

    expect(hits.map(hit => hit.name)).toEqual(['Quarterly Report.pdf'])
  })

  it('treats wildcards in the query as literal characters', async () => {
    await recordDriveListing('svc', '/my-files', [
      entry('/my-files/100%_done.txt'),
      entry('/my-files/10x.txt')
    ], db)

    expect((await searchDriveEntries(['svc'], '0%_', 10, db)).map(hit => hit.name)).toEqual(['100%_done.txt'])
    expect((await searchDriveEntries(['svc'], '%', 10, db)).map(hit => hit.name)).not.toContain('10x.txt')
    expect((await searchDriveEntries(['svc'], '_', 10, db)).map(hit => hit.name)).not.toContain('10x.txt')
  })

  it('leaves out trashed entries', async () => {
    await recordDriveListing('svc', '/trash', [entry('/trash/old-report.pdf')], db)

    expect(await searchDriveEntries(['svc'], 'report', 10, db)).toEqual([])
  })

  it('only searches the given services', async () => {
    await recordDriveListing('svc', '/my-files', [entry('/my-files/shared-name.txt')], db)
    await recordDriveListing('other', '/my-files', [entry('/my-files/shared-name.txt')], db)

    const hits = await searchDriveEntries(['svc'], 'shared-name', 10, db)

    expect(hits.map(hit => hit.service)).toEqual(['svc'])
  })

  it('ranks an exact name before a longer name containing it', async () => {
    await recordDriveListing('svc', '/my-files', [
      entry('/my-files/report'),
      entry('/my-files/Quarterly report.pdf')
    ], db)

    const hits = await searchDriveEntries(['svc'], 'report', 10, db)

    expect(hits.map(hit => hit.name)).toEqual(['report', 'Quarterly report.pdf'])
  })
})
