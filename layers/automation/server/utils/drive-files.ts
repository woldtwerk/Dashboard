import { and, eq, inArray } from 'drizzle-orm'
import { automationDriveFiles } from '../db/schema'

/** The identity of one saved file: its content in one folder of one drive */
export interface DriveFileRecord {
  service: string
  folder: string
  sha256: string
  path: string
  size: number
}

/** Whether the same bytes were already saved into this folder */
export async function hasDriveFile(service: string, folder: string, sha256: string): Promise<boolean> {
  const row = await (await useDb()).select({ sha256: automationDriveFiles.sha256 })
    .from(automationDriveFiles)
    .where(and(
      eq(automationDriveFiles.service, service),
      eq(automationDriveFiles.folder, folder),
      eq(automationDriveFiles.sha256, sha256)
    ))
    .get()

  return !!row
}

/** Whether a failed insert only lost the race for an already recorded file */
export function isDriveFileConflict(error: unknown): boolean {
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
  return value.cause !== undefined && value.cause !== error ? isDriveFileConflict(value.cause) : false
}

/**
 * Records an uploaded file. `false` means another worker recorded the same
 * content in this folder first; the upload itself is accepted, because both
 * workers were already past the check when they uploaded.
 */
export async function recordDriveFile(file: DriveFileRecord): Promise<boolean> {
  try {
    await (await useDb()).insert(automationDriveFiles).values({
      ...file,
      createdAt: new Date()
    })
    return true
  } catch (error) {
    if (isDriveFileConflict(error)) {
      return false
    }
    throw error
  }
}

/** Drops the records of files that were trashed, so the same bytes may be saved again */
export async function forgetDriveFiles(service: string, paths: string[]): Promise<void> {
  if (!paths.length) {
    return
  }

  await (await useDb()).delete(automationDriveFiles)
    .where(and(
      eq(automationDriveFiles.service, service),
      inArray(automationDriveFiles.path, paths)
    ))
}
