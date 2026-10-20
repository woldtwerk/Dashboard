import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Rebuildable contacts cache. Services live in the main database, so no foreign
// keys here; a removed service is cleaned up by the contacts Nitro plugin.

/** Address books of a service, plus the ctag their cards were last synced with */
export const contactsAddressBooks = sqliteTable('contacts_address_books', {
  service: text('service').notNull(),
  url: text('url').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  /** Collection ctag; a change means the card list must be diffed */
  ctag: text('ctag'),
  syncToken: text('sync_token')
}, table => [
  primaryKey({ columns: [table.service, table.url] })
])

/** Raw vCards, one row per DAV object */
export const contactsCards = sqliteTable('contacts_cards', {
  service: text('service').notNull(),
  addressBookUrl: text('address_book_url').notNull(),
  url: text('url').notNull(),
  etag: text('etag'),
  uid: text('uid').notNull(),
  /** The raw vCard, parsed when a contact is read */
  data: text('data').notNull()
}, table => [
  primaryKey({ columns: [table.service, table.url] }),
  index('contacts_cards_address_book_idx').on(table.service, table.addressBookUrl)
])

/** Last sync result of a service; `error` is cleared by the next successful run */
export const contactsSync = sqliteTable('contacts_sync', {
  service: text('service').primaryKey(),
  syncedAt: integer('synced_at', { mode: 'timestamp_ms' }),
  error: text('error'),
  /** Version of the stored cards; an older one makes the next sync refetch */
  version: integer('version').notNull().default(0)
})
