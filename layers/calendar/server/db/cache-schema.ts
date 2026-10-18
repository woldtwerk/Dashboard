import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Rebuildable calendar cache. Services live in the main database, so no foreign
// keys here; a removed service is cleaned up by the calendar Nitro plugin.

/** Calendars of a service, plus the ctag their objects were last synced with */
export const calendarCollections = sqliteTable('calendar_collections', {
  service: text('service').notNull(),
  url: text('url').notNull(),
  name: text('name').notNull(),
  color: text('color'),
  description: text('description'),
  /** Collection ctag; a change means the object list must be diffed */
  ctag: text('ctag'),
  syncToken: text('sync_token'),
  syncedAt: integer('synced_at', { mode: 'timestamp_ms' })
}, table => [
  primaryKey({ columns: [table.service, table.url] })
])

/** Raw iCalendar objects, bounded so a window query can skip the rest */
export const calendarObjects = sqliteTable('calendar_objects', {
  service: text('service').notNull(),
  calendarUrl: text('calendar_url').notNull(),
  url: text('url').notNull(),
  etag: text('etag'),
  uid: text('uid').notNull(),
  /** The raw iCalendar object, expanded when a window is read */
  data: text('data').notNull(),
  /** Normalized emails of ORGANIZER and ATTENDEE as a JSON array, for participant queries */
  participants: text('participants').notNull().default('[]'),
  firstStart: integer('first_start', { mode: 'timestamp_ms' }).notNull(),
  /** End of the last occurrence; null for a series without an end */
  lastEnd: integer('last_end', { mode: 'timestamp_ms' })
}, table => [
  primaryKey({ columns: [table.service, table.url] }),
  index('calendar_objects_calendar_start_idx').on(table.service, table.calendarUrl, table.firstStart)
])

/** Last sync result of a service; `error` is cleared by the next successful run */
export const calendarSync = sqliteTable('calendar_sync', {
  service: text('service').primaryKey(),
  syncedAt: integer('synced_at', { mode: 'timestamp_ms' }),
  error: text('error'),
  /** Version of the stored bounds; an older one makes the next sync refetch */
  version: integer('version').notNull().default(0)
})
