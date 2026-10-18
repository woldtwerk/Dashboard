import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import type { CalendarEvent } from '../../../../shared/types/calendar'
import { eventsQuerySchema, toEventWindow } from '../../../utils/calendar-schema'

export default defineEventHandler(async (event) => {
  const { service, calendar, start, end } = await getValidatedQuery(event, eventsQuerySchema)
  const window = toEventWindow({ start, end })
  const services = service ? [service] : (await listServices('calendar')).map(item => item.id)
  const timeZone = useRuntimeConfig().public.calendar.timeZone

  const results = await Promise.all(services.map(async (id) => {
    try {
      return await listServiceEvents(id, calendar, window, timeZone)
    } catch (error) {
      // A single requested service reports its own error; across services, one
      // failing must not hide the others.
      if (service) {
        throw error
      }
      return []
    }
  }))

  return results.flat().sort((a, b) => a.start.localeCompare(b.start))
})

// Reads never hit the CalDAV server once the service has synced; hidden
// calendars are included, because the view decides which ones it draws.
async function listServiceEvents(id: string, calendar: string | undefined, window: { start: string, end: string }, timeZone: string): Promise<CalendarEvent[]> {
  await ensureCalendarSynced(id)
  const calendars = calendar ? [calendar] : (await cachedCalendars(id)).map(item => item.url)

  return cachedEvents(id, calendars, window, timeZone)
}
