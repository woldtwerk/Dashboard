import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Rebuildable drive cache. Services live in the main database, so no foreign
// keys here; a removed service is cleaned up by the drive Nitro plugin.

/** One entry of a cached folder listing */
export const driveEntries = sqliteTable('drive_entries', {
  service: text('service').notNull(),
  path: text('path').notNull(),
  /** Path of the folder that holds the entry */
  parent: text('parent').notNull(),
  uid: text('uid').notNull(),
  name: text('name').notNull(),
  /** Normalized name for the global search; see `normalizeSearchText` */
  nameSearch: text('name_search').notNull().default(''),
  type: text('type', { enum: ['folder', 'file'] }).notNull(),
  /** Bytes; only known for files */
  size: integer('size'),
  /** ISO 8601 timestamp of the last change */
  modified: text('modified'),
  mediaType: text('media_type'),
  webUrl: text('web_url')
}, table => [
  primaryKey({ columns: [table.service, table.path] }),
  index('drive_entries_parent_idx').on(table.service, table.parent)
])

/**
 * One row per folder, which also makes this the crawl queue: `listed_at` null
 * means the folder is due, either because it was never listed or because a
 * mutation made it due again.
 */
export const driveFolders = sqliteTable('drive_folders', {
  service: text('service').notNull(),
  path: text('path').notNull(),
  /** When the folder was last listed; null means due now */
  listedAt: integer('listed_at', { mode: 'timestamp_ms' }),
  /** The last failure for this folder; cleared by the next successful list */
  error: text('error')
}, table => [
  primaryKey({ columns: [table.service, table.path] })
])

/**
 * Last crawl result of a service. `synced_at` is set when a whole pass found
 * nothing due; `error` is cleared by the next successful pass.
 */
export const driveSync = sqliteTable('drive_sync', {
  service: text('service').primaryKey(),
  syncedAt: integer('synced_at', { mode: 'timestamp_ms' }),
  error: text('error')
})
