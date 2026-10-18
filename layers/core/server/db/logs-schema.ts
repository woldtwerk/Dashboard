import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Rebuildable logs cache. The main database holds services and navigation; log
// lines and sync runs are high-volume and pruned, so they live in their own
// SQLite file and can be deleted without losing configuration.

/** One structured log line, written by every domain through `useServiceLogger` */
export const logEntries = sqliteTable('log_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  level: text('level').notNull(),
  domain: text('domain').notNull(),
  service: text('service'),
  message: text('message').notNull(),
  /** Masked JSON object, serialized by the logger */
  meta: text('meta')
}, table => [
  index('log_entries_at_idx').on(table.at),
  index('log_entries_domain_at_idx').on(table.domain, table.at),
  index('log_entries_level_at_idx').on(table.level, table.at)
])

/** One finished background sync run, so activity and health stay queryable */
export const syncRuns = sqliteTable('sync_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  domain: text('domain').notNull(),
  service: text('service').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  durationMs: integer('duration_ms').notNull(),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  changed: integer('changed').notNull()
}, table => [
  index('sync_runs_domain_started_at_idx').on(table.domain, table.startedAt)
])

/** Key/value state of the logs database, e.g. when it was last pruned */
export const logsState = sqliteTable('logs_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})
