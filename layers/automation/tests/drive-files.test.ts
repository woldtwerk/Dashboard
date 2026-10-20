import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, openSqlite } from '#layers/core/server/db/client'
import { automationDriveFiles } from '../server/db/schema'
import { forgetDriveFiles, hasDriveFile, isDriveFileConflict, recordDriveFile } from '../server/utils/drive-files'

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

beforeEach(() => {
  sqlite = openSqlite(':memory:')
  sqlite.exec(`
    CREATE TABLE automation_drive_files (
      service text NOT NULL,
      folder text NOT NULL,
      sha256 text NOT NULL,
      path text NOT NULL,
      size integer NOT NULL,
      created_at integer NOT NULL
    );
    CREATE UNIQUE INDEX automation_drive_files_service_folder_sha256_idx
      ON automation_drive_files (service, folder, sha256);
  `)
  const db = createDatabase(sqlite, { automationDriveFiles })
  vi.stubGlobal('useDb', () => db)
})

afterEach(() => {
  vi.unstubAllGlobals()
  sqlite.close()
})

describe('the saved-file records', () => {
  it('records a file and finds it by its content in the same folder', async () => {
    await expect(recordDriveFile(file())).resolves.toBe(true)

    expect(await hasDriveFile('drive-1', '/my-files/Public', 'a'.repeat(64))).toBe(true)
    // Another folder or drive does not share the content
    expect(await hasDriveFile('drive-1', '/my-files/Other', 'a'.repeat(64))).toBe(false)
    expect(await hasDriveFile('drive-2', '/my-files/Public', 'a'.repeat(64))).toBe(false)
  })

  it('reports a second record of the same content as a conflict', async () => {
    expect(await recordDriveFile(file())).toBe(true)
    // A race: another worker uploaded the same bytes before its insert
    expect(await recordDriveFile(file({ path: '/my-files/Public/holiday (1).mp4' }))).toBe(false)

    expect(await hasDriveFile('drive-1', '/my-files/Public', 'a'.repeat(64))).toBe(true)
  })

  it('deletes the rows of trashed files, so the content can be saved again', async () => {
    await recordDriveFile(file())
    await recordDriveFile(file({ sha256: 'b'.repeat(64), path: '/my-files/Public/other.mp4' }))
    await recordDriveFile(file({ service: 'drive-2' }))

    await forgetDriveFiles('drive-1', ['/my-files/Public/holiday.mp4'])

    expect(await hasDriveFile('drive-1', '/my-files/Public', 'a'.repeat(64))).toBe(false)
    expect(await hasDriveFile('drive-1', '/my-files/Public', 'b'.repeat(64))).toBe(true)
    // Another drive keeps its row
    expect(await hasDriveFile('drive-2', '/my-files/Public', 'a'.repeat(64))).toBe(true)
  })

  it('does nothing when no paths were trashed', async () => {
    await recordDriveFile(file())
    await forgetDriveFiles('drive-1', [])
    expect(await hasDriveFile('drive-1', '/my-files/Public', 'a'.repeat(64))).toBe(true)
  })
})

describe('isDriveFileConflict', () => {
  it('recognises the SQLite unique violation and nothing else', () => {
    expect(isDriveFileConflict(new Error('UNIQUE constraint failed: automation_drive_files.service, automation_drive_files.folder'))).toBe(true)
    expect(isDriveFileConflict(new Error('SQLITE_CONSTRAINT_UNIQUE'))).toBe(true)
    expect(isDriveFileConflict({ code: 'ERR_SQLITE_ERROR', errcode: 2067, errstr: 'constraint failed' })).toBe(true)
    expect(isDriveFileConflict({ message: 'Failed query', cause: { errcode: 2067 } })).toBe(true)
    expect(isDriveFileConflict(new Error('database is locked'))).toBe(false)
    expect(isDriveFileConflict(undefined)).toBe(false)
  })
})
