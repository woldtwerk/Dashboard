import { defineEventHandler } from 'nuxt/server'
import type { CalendarSyncStatus } from '../../../shared/types/calendar'

// Background sync state of every calendar service
export default defineEventHandler(async (): Promise<CalendarSyncStatus[]> => {
  const services = await listServices('calendar')

  return Promise.all(services.map(({ id }) => getCalendarSyncStatus(id)))
})
