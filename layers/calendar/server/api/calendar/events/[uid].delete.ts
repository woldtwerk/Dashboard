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

  return { ok: true }
})
