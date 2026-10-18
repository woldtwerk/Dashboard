import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { services } from '../../../core/server/db/schema'

/** Which calendars a service shows; a missing row means visible */
export const calendarPreferences = sqliteTable('calendar_preferences', {
  service: text('service').notNull().references(() => services.id, { onDelete: 'cascade' }),
  calendarUrl: text('calendar_url').notNull(),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false)
}, table => [
  primaryKey({ columns: [table.service, table.calendarUrl] })
])
