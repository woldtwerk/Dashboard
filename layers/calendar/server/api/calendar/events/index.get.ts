import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import type { CalendarEvent } from '../../../../shared/types/calendar'
import { eventsQuerySchema, toEventWindow } from '../../../utils/calendar-schema'

export default defineEventHandler(async (event) => {
  const { service, calendar, start, end } = await getValidatedQuery(event, eventsQuerySchema)
  const window = toEventWindow({ start, end })
  const services = service ? [service] : (await listServices('calendar')).map(item => item.id)

  const results = await Promise.all(services.map(async (id) => {
    try {
      return await listServiceEvents(id, calendar, window)
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

async function listServiceEvents(id: string, calendar: string | undefined, window: { start: string, end: string }): Promise<CalendarEvent[]> {
  const provider = await useCalendarProvider(id)
  const calendars = calendar ? [calendar] : (await provider.listCalendars()).map(item => item.url)
  const lists = await Promise.all(calendars.map(url => provider.listEvents(url, window)))

  return lists.flat().map(item => ({ ...item, service: id }))
}
