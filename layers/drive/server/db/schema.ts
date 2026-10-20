import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Files already saved into a drive folder, keyed by their content. The same
 * video often arrives again under another name; the hash makes a rerun skip it.
 * The row is written right after an upload succeeded, and undo drops it together
 * with the trashed file.
 */
export const driveSavedFiles = sqliteTable('drive_saved_files', {
  service: text('service').notNull(),
  folder: text('folder').notNull(),
  /** Lower-case SHA-256 of the file's bytes */
  sha256: text('sha256').notNull(),
  /** The path the file was uploaded to */
  path: text('path').notNull(),
  size: integer('size').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
}, table => [
  uniqueIndex('drive_saved_files_service_folder_sha256_idx').on(table.service, table.folder, table.sha256)
])

export type DriveSavedFileRow = typeof driveSavedFiles.$inferSelect
