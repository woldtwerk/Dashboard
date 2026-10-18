import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import type { CalendarEvent } from '../../../../shared/types/calendar'
import { eventDeleteSchema } from '../../../utils/calendar-schema'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  if (!uid) {
    throw createError({ status: 400, statusText: 'Missing event uid' })
  }

  const { service, calendar, url, etag, scope, recurrenceId } = await readValidatedBody(event, eventDeleteSchema)
  const provider = await useCalendarProvider(service)
  const existing: CalendarEvent = {
    uid,
    calendar,
    url,
    etag,
    recurrenceId: recurrenceId?.toISOString(),
    title: '',
    start: '',
    end: '',
    allDay: false
  }

  await provider.deleteEvent(existing, scope)

  if (url) {
    // Cancelling one occurrence leaves the object in place; deleting the series removes it
    if (scope === 'one') {
      await refreshCalendarObject(service, calendar, url)
    } else {
      await removeCachedObject(service, url)
    }
  }

  return { ok: true }
})
