import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { services } from '../../../core/server/db/schema'

/** Sync state of the search index per mailbox */
export const mailIndexMailboxes = sqliteTable('mail_index_mailboxes', {
  service: text('service').notNull().references(() => services.id, { onDelete: 'cascade' }),
  mailbox: text('mailbox').notNull(),
  uidValidity: text('uid_validity').notNull(),
  /** First full pass done; until then search falls back to the provider */
  complete: integer('complete', { mode: 'boolean' }).notNull().default(false),
  /** Index document shape last written for this mailbox; a lower one is rebuilt once */
  schemaVersion: integer('schema_version').notNull().default(0),
  syncedAt: integer('synced_at', { mode: 'timestamp_ms' })
}, table => [
  primaryKey({ columns: [table.service, table.mailbox] })
])

/** Indexed messages with the flags last sent to the index, to detect changes and deletions */
export const mailIndexMessages = sqliteTable('mail_index_messages', {
  service: text('service').notNull().references(() => services.id, { onDelete: 'cascade' }),
  mailbox: text('mailbox').notNull(),
  uid: integer('uid').notNull(),
  unread: integer('unread', { mode: 'boolean' }).notNull(),
  flagged: integer('flagged', { mode: 'boolean' }).notNull()
}, table => [
  primaryKey({ columns: [table.service, table.mailbox, table.uid] })
])
