import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, openSqlite } from '#layers/core/server/db/client'
import { loadMigrations, runMigrations } from '#layers/core/server/db/migrate'
import { driveSavedFiles } from '../server/db/schema'
import { forgetSavedFiles, hasSavedFile, isSavedFileConflict, recordSavedFile } from '../server/utils/drive-files'

const migrationsDir = fileURLToPath(new URL('../../core/server/db/migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

let sqlite: ReturnType<typeof openSqlite>

function file(overrides: Partial<{ service: string, folder: string, sha256: string, path: string, size: number }> = {}) {
  return {
    service: 'drive-1',
    folder: '/my-files/Public',
    sha256: 'a'.repeat(64),
    path: '/my-files/Public/holiday.mp4',
    size: 10,
    ...overrides
  }
}

beforeEach(async () => {
  sqlite = openSqlite(':memory:')
  runMigrations(sqlite, await loadMigrations(readMigration))
  const db = createDatabase(sqlite, { driveSavedFiles })
  vi.stubGlobal('useDb', () => db)
})

afterEach(() => {
  vi.unstubAllGlobals()
  sqlite.close()
})

describe('the saved-file records', () => {
  it('records a file and finds it by its content in the same folder', async () => {
    await expect(recordSavedFile(file())).resolves.toBe(true)

    expect(await hasSavedFile('drive-1', '/my-files/Public', 'a'.repeat(64))).toBe(true)
    // Another folder or drive does not share the content
    expect(await hasSavedFile('drive-1', '/my-files/Other', 'a'.repeat(64))).toBe(false)
    expect(await hasSavedFile('drive-2', '/my-files/Public', 'a'.repeat(64))).toBe(false)
  })

  it('reports a second record of the same content as a conflict', async () => {
    expect(await recordSavedFile(file())).toBe(true)
    // A race: another worker uploaded the same bytes before its insert
    expect(await recordSavedFile(file({ path: '/my-files/Public/holiday (1).mp4' }))).toBe(false)

    expect(await hasSavedFile('drive-1', '/my-files/Public', 'a'.repeat(64))).toBe(true)
  })

  it('deletes the rows of trashed files, so the content can be saved again', async () => {
    await recordSavedFile(file())
    await recordSavedFile(file({ sha256: 'b'.repeat(64), path: '/my-files/Public/other.mp4' }))
    await recordSavedFile(file({ service: 'drive-2' }))

    await forgetSavedFiles('drive-1', ['/my-files/Public/holiday.mp4'])

    expect(await hasSavedFile('drive-1', '/my-files/Public', 'a'.repeat(64))).toBe(false)
    expect(await hasSavedFile('drive-1', '/my-files/Public', 'b'.repeat(64))).toBe(true)
    // Another drive keeps its row
    expect(await hasSavedFile('drive-2', '/my-files/Public', 'a'.repeat(64))).toBe(true)
  })
})

describe('isSavedFileConflict', () => {
  it('recognises the SQLite unique violation and nothing else', () => {
    expect(isSavedFileConflict(new Error('UNIQUE constraint failed: drive_saved_files.service, drive_saved_files.folder'))).toBe(true)
    expect(isSavedFileConflict(new Error('SQLITE_CONSTRAINT_UNIQUE'))).toBe(true)
    expect(isSavedFileConflict({ code: 'ERR_SQLITE_ERROR', errcode: 2067, errstr: 'constraint failed' })).toBe(true)
    expect(isSavedFileConflict({ message: 'Failed query', cause: { errcode: 2067 } })).toBe(true)
    expect(isSavedFileConflict(new Error('database is locked'))).toBe(false)
    expect(isSavedFileConflict(undefined)).toBe(false)
  })
})
