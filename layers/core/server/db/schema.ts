import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Configured service instances (e.g. one Proton account) */
export const services = sqliteTable('services', {
  id: text('id').primaryKey(),
  connector: text('connector').notNull(),
  domain: text('domain').notNull(),
  name: text('name').notNull(),
  icon: text('icon'),
  /** AES-256-GCM encrypted SetupValues, see server/utils/services.ts */
  settings: text('settings').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
}, table => [
  index('services_domain_idx').on(table.domain)
])

/** Leases for work that must run on one cluster worker at a time, see server/db/locks.ts */
export const locks = sqliteTable('locks', {
  name: text('name').primaryKey(),
  owner: text('owner').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull()
})
