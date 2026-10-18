import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import type { CalendarEventInput } from '../../../../shared/types/calendar'
import { eventBodySchema } from '../../../utils/calendar-schema'

export default defineEventHandler(async (event) => {
  const { service, calendar, ...rest } = await readValidatedBody(event, eventBodySchema)
  const input: CalendarEventInput = { ...rest, calendar, start: rest.start.toISOString(), end: rest.end.toISOString() }
  const provider = await useCalendarProvider(service)
  const created = await provider.createEvent(calendar, input)

  // Refetch, so the next read sees exactly what the server stored
  if (created.url) {
    await refreshCalendarObject(service, calendar, created.url)
  }

  return { ...created, service }
})
