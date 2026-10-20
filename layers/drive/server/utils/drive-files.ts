import { and, eq, inArray } from 'drizzle-orm'
import { driveSavedFiles } from '../db/schema'

/** The identity of one saved file: its content in one folder of one drive */
export interface DriveFileRecord {
  service: string
  folder: string
  sha256: string
  path: string
  size: number
}

/** Whether the same bytes were already saved into this folder */
export async function hasSavedFile(service: string, folder: string, sha256: string): Promise<boolean> {
  const row = await (await useDb()).select({ sha256: driveSavedFiles.sha256 })
    .from(driveSavedFiles)
    .where(and(
      eq(driveSavedFiles.service, service),
      eq(driveSavedFiles.folder, folder),
      eq(driveSavedFiles.sha256, sha256)
    ))
    .get()

  return !!row
}

/** Whether a failed insert only lost the race for an already recorded file */
export function isSavedFileConflict(error: unknown): boolean {
  const value = error as { code?: string, errcode?: number, errstr?: string, message?: string, cause?: unknown } | undefined
  if (!value) {
    return false
  }

  // 2067 is SQLite's extended SQLITE_CONSTRAINT_UNIQUE; drizzle wraps the driver error
  if (value.errcode === 2067) {
    return true
  }
  if (/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(`${value.message ?? ''} ${value.errstr ?? ''}`)) {
    return true
  }
  return value.cause !== undefined && value.cause !== error ? isSavedFileConflict(value.cause) : false
}

/**
 * Records an uploaded file. `false` means another worker recorded the same
 * content in this folder first; the upload itself is accepted, because both
 * workers were already past the check when they uploaded.
 */
export async function recordSavedFile(file: DriveFileRecord): Promise<boolean> {
  try {
    await (await useDb()).insert(driveSavedFiles).values({
      ...file,
      createdAt: new Date()
    })
    return true
  } catch (error) {
    if (isSavedFileConflict(error)) {
      return false
    }
    throw error
  }
}

/** Drops the records of files that were trashed, so the same bytes may be saved again */
export async function forgetSavedFiles(service: string, paths: string[]): Promise<void> {
  if (!paths.length) {
    return
  }

  await (await useDb()).delete(driveSavedFiles)
    .where(and(
      eq(driveSavedFiles.service, service),
      inArray(driveSavedFiles.path, paths)
    ))
}
