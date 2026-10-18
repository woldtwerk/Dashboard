import { eq } from 'drizzle-orm'
import { defineEventHandler, isNuxtError } from 'nuxt/server'
import type { CalendarList } from '../../../shared/types/calendar'
import { calendarPreferences } from '../../db/schema'

// Calendars of all calendar services, served from the local cache; one
// unreachable service doesn't break the others
export default defineEventHandler(async () => {
  const services = await listServices('calendar')

  return Promise.all(services.map(async ({ id, name, icon }): Promise<CalendarList> => {
    try {
      await ensureCalendarSynced(id)
      const [calendars, preferences] = await Promise.all([
        cachedCalendars(id),
        (await useDb()).select().from(calendarPreferences).where(eq(calendarPreferences.service, id))
      ])
      const hidden = new Map(preferences.map(row => [row.calendarUrl, row.hidden]))

      return {
        service: { id, name, icon },
        calendars: calendars.map(calendar => ({
          url: calendar.url,
          name: calendar.name,
          color: calendar.color ?? undefined,
          description: calendar.description ?? undefined,
          hidden: hidden.get(calendar.url) ?? false,
          service: id,
          serviceName: name,
          icon
        }))
      }
    } catch (error) {
      return { service: { id, name, icon }, calendars: [], error: (isNuxtError(error) && error.statusText) || 'Unavailable' }
    }
  }))
})
