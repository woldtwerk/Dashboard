import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { calendarSearchSchema } from '../../utils/calendar-schema'

// Full-text search across the cached events of every calendar service, best
// match first. Hidden calendars are left out.
export default defineEventHandler(async (event) => {
  const { q, limit } = await getValidatedQuery(event, calendarSearchSchema)

  // A single character would match a compound in the middle; the toolbar asks from two on
  if (!q || q.length < 2) {
    return []
  }

  const services = (await listServices('calendar')).map(item => item.id)
  if (!services.length) {
    return []
  }

  const excludeCalendars = await hiddenCalendarUrls(services)
  const hits = await searchEvents(services, q, { limit, excludeCalendars })

  return hits.map(hit => ({
    ref: hit.ref,
    summary: hit.summary,
    summaryHighlight: hit.summaryHighlight,
    snippet: hit.snippet,
    calendar: hit.calendar,
    start: hit.start,
    end: hit.end,
    allDay: hit.allDay,
    location: hit.location
  }))
})
