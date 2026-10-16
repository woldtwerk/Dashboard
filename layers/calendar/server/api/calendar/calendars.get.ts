import { defineEventHandler, isNuxtError } from 'nuxt/server'
import type { CalendarList } from '../../../shared/types/calendar'

// Calendars of all calendar services; one unreachable service doesn't break the others
export default defineEventHandler(async () => {
  const services = await listServices('calendar')

  return Promise.all(services.map(async ({ id, name, icon }): Promise<CalendarList> => {
    try {
      const provider = await useCalendarProvider(id)
      const calendars = (await provider.listCalendars()).map(calendar => ({ ...calendar, service: id, serviceName: name, icon }))

      return { service: { id, name, icon }, calendars }
    } catch (error) {
      return { service: { id, name, icon }, calendars: [], error: (isNuxtError(error) && error.statusText) || 'Unavailable' }
    }
  }))
})
