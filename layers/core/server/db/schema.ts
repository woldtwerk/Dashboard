import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { AppPasswordScope } from '../../shared/types/app-passwords'

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

/** Bearer tokens for MCP clients; only the hash is stored, the token is shown once */
export const mcpTokens = sqliteTable('mcp_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Lower-case hex SHA-256 of the token */
  tokenHash: text('token_hash').notNull().unique(),
  scope: text('scope', { enum: ['read', 'write'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
})

/** Per-device app passwords for CalDAV/CardDAV/IMAP/SMTP; only the hash is stored */
export const appPasswords = sqliteTable('app_passwords', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** JSON array of scopes: 'dav' and/or 'mail' */
  scopes: text('scopes', { mode: 'json' }).$type<AppPasswordScope[]>().notNull(),
  /** Lower-case hex SHA-256 of the token */
  tokenHash: text('token_hash').notNull().unique(),
  /** First characters of the token, for display */
  prefix: text('prefix').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
})

/** User order and renaming of the sidebar entries; a missing row means the layer's default */
export const navigationPreferences = sqliteTable('navigation_preferences', {
  key: text('key').primaryKey(),
  /** Overrides the layer's label when set; null keeps the default */
  label: text('label'),
  /** Position in the sidebar; lower comes first */
  position: integer('position').notNull()
})

/** One settings section, keyed by its registry id; `value` is the JSON encoded section */
export const userSettings = sqliteTable('user_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

/** Notifications delivered to the bell and (optionally) the desktop */
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  /** In-app route the notification opens */
  to: text('to'),
  domain: text('domain').notNull(),
  service: text('service'),
  /** Stable key for "this was already sent"; null means no deduplication */
  dedupeKey: text('dedupe_key').unique(),
  at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  readAt: integer('read_at', { mode: 'timestamp_ms' })
}, table => [
  index('notifications_at_idx').on(table.at),
  index('notifications_read_at_idx').on(table.readAt)
])

/** Dashboard accounts; the login layer authenticates against them */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  /** Stored lower-case */
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
})

/** Browser Push API subscriptions, one per browser or device */
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  /** Null while nobody is signed in on that browser */
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
})
