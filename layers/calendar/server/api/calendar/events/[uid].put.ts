import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import type { CalendarEvent } from '../../../../shared/types/calendar'
import type { EventEdit } from '../../../utils/calendar-ical'
import { eventUpdateSchema } from '../../../utils/calendar-schema'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  if (!uid) {
    throw createError({ status: 400, statusText: 'Missing event uid' })
  }

  const { service, calendar, url, etag, scope, recurrenceId, ...rest } = await readValidatedBody(event, eventUpdateSchema)
  const provider = await useCalendarProvider(service)
  const existing: CalendarEvent = {
    uid,
    calendar,
    url,
    etag,
    recurrenceId: recurrenceId?.toISOString(),
    title: rest.title,
    start: rest.start.toISOString(),
    end: rest.end.toISOString(),
    allDay: !!rest.allDay
  }
  const edit: EventEdit = { ...rest, start: rest.start.toISOString(), end: rest.end.toISOString() }

  await provider.updateEvent(existing, edit, scope)

  // Refetch the object, so the cache reflects the stored series or override
  if (url) {
    await refreshCalendarObject(service, calendar, url)
  }

  return { ok: true }
})
