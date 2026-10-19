import { createError } from 'nuxt/server'
import { z } from 'zod'
import type { DomainTool, ToolSource } from '../../core/shared/types/tools'
import { entityLink } from '../../core/shared/entities'
import type { Calendar } from '../shared/types/calendar'

/** A tool window may span at most this many days. */
export const CALENDAR_TOOL_MAX_RANGE_DAYS = 92

/** The event fields as the tools receive them; the times are ISO 8601 strings. */
interface CalendarToolEvent {
  title: string
  start: string
  end: string
  allDay?: boolean
  description?: string
  location?: string
  recurrence?: string
  reminders?: number[]
}

/** One event as `calendar_list_events` returns it, with the ids its link needs. */
interface CalendarToolEventResult extends CalendarToolEvent {
  uid: string
  calendar: string
  recurrenceId?: string
  service?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Source cards for `calendar_list_events`: one row per event in the window. */
export function calendarEventSources(output: unknown): ToolSource[] {
  const events = (output as { events?: Partial<CalendarToolEventResult>[] } | undefined)?.events
  if (!Array.isArray(events)) {
    return []
  }

  return events.flatMap((event) => {
    if (!event.title || !event.uid || !event.calendar) {
      return []
    }

    return [{
      kind: 'event',
      title: event.title,
      ...(event.location ? { subtitle: event.location } : {}),
      ...(event.start ? { date: event.start } : {}),
      link: entityLink({
        type: 'event',
        service: event.service,
        id: `${event.calendar}|${event.uid}|${event.recurrenceId ?? ''}`
      })
    }]
  })
}

/** Source cards for `calendar_list_calendars`: one row per calendar. */
export function calendarListSources(output: unknown): ToolSource[] {
  if (!Array.isArray(output)) {
    return []
  }

  return (output as { service: string, calendars?: Partial<Calendar>[] }[]).flatMap(entry =>
    (entry.calendars ?? []).flatMap(calendar => calendar.name
      ? [{
          kind: 'calendar',
          title: calendar.name,
          subtitle: calendar.serviceName || entry.service,
          link: '/calendar'
        }]
      : []))
}

/** Validates and normalizes the window of `calendar_list_events`. */
export function toCalendarToolWindow(range: { start: Date, end: Date }): { start: string, end: string } {
  if (Number.isNaN(range.start.getTime()) || Number.isNaN(range.end.getTime())) {
    throw createError({ status: 400, statusText: 'Start and end must be ISO 8601 dates' })
  }
  if (range.end <= range.start) {
    throw createError({ status: 400, statusText: 'The range end must be after its start' })
  }
  if (range.end.getTime() - range.start.getTime() > CALENDAR_TOOL_MAX_RANGE_DAYS * DAY_MS) {
    throw createError({ status: 400, statusText: `The range may span at most ${CALENDAR_TOOL_MAX_RANGE_DAYS} days` })
  }

  return { start: range.start.toISOString(), end: range.end.toISOString() }
}

const serviceInput = z.string().min(1).optional().describe('Calendar service id; omit to use every configured calendar account')
const calendarInput = z.string().min(1).describe('Calendar collection URL from calendar_list_calendars')
const isoDate = z.string().trim().refine(value => !Number.isNaN(new Date(value).getTime()), 'Use an ISO 8601 date')
const startInput = isoDate.describe('Start as ISO 8601 with offset, e.g. 2026-10-20T09:00:00+02:00')
const endInput = isoDate.describe('End as ISO 8601 with offset; must be after the start')

const eventFields = {
  title: z.string().trim().min(1).max(500).describe('Event title'),
  start: startInput,
  end: endInput,
  allDay: z.boolean().optional().describe('True for an all-day event'),
  description: z.string().max(20_000).optional().describe('Plain-text description'),
  location: z.string().max(1000).optional().describe('Location text'),
  recurrence: z.string().max(1000).optional().describe('RRULE value without the prefix, e.g. "FREQ=WEEKLY;BYDAY=MO"'),
  reminders: z.array(z.number().int().min(0).max(40_320)).max(10).optional().describe('Reminder offsets in minutes before the start')
}

const scopeInput = z.enum(['one', 'all']).default('all').describe('Apply to one occurrence of a series or the whole series')

export const calendarTools: DomainTool[] = [
  {
    name: 'calendar_list_calendars',
    domain: 'calendar',
    description: 'List the calendars of the configured accounts with their name, colour and collection URL. The URL is needed by the other calendar tools.',
    input: z.object({ service: serviceInput }),
    writes: false,
    execute: async (raw) => {
      const { service } = raw as { service?: string }
      const services = service ? [service] : (await listServices('calendar')).map(item => item.id)

      return Promise.all(services.map(async (id) => {
        try {
          await ensureCalendarSynced(id)
          const calendars = await cachedCalendars(id)
          return { service: id, calendars }
        } catch (error) {
          return { service: id, calendars: [], error: error instanceof Error ? error.message : 'Unavailable' }
        }
      }))
    },
    sources: calendarListSources
  },
  {
    name: 'calendar_list_events',
    domain: 'calendar',
    description: `List events between two dates, expanded for recurring events. The window may span at most ${CALENDAR_TOOL_MAX_RANGE_DAYS} days. Omit \`calendar\` to list every calendar of the service.`,
    input: z.object({
      service: serviceInput,
      calendar: z.string().min(1).optional().describe('Calendar collection URL; omit for every calendar of the service'),
      start: startInput.describe('Window start as ISO 8601, inclusive'),
      end: endInput.describe('Window end as ISO 8601, exclusive')
    }),
    writes: false,
    execute: async (raw) => {
      const input = raw as { service?: string, calendar?: string, start: string, end: string }
      const window = toCalendarToolWindow({ start: new Date(input.start), end: new Date(input.end) })
      const services = input.service ? [input.service] : (await listServices('calendar')).map(item => item.id)
      const timeZone = useRuntimeConfig().public.calendar.timeZone
      const events = []

      for (const service of services) {
        try {
          await ensureCalendarSynced(service)
          const calendars = input.calendar ? [input.calendar] : (await cachedCalendars(service)).map(item => item.url)
          events.push(...(await cachedEvents(service, calendars, window, timeZone)).map(event => ({ ...event, service })))
        } catch (error) {
          if (input.service) {
            throw error
          }
        }
      }

      return { events: events.sort((a, b) => a.start.localeCompare(b.start)) }
    },
    sources: calendarEventSources
  },
  {
    name: 'calendar_create_event',
    domain: 'calendar',
    description: 'Create one event in a calendar. Times are ISO 8601 with offset; a recurrence is an RRULE value such as "FREQ=WEEKLY;BYDAY=MO".',
    input: z.object({ service: z.string().min(1).describe('Calendar service id'), calendar: calendarInput, ...eventFields }),
    writes: true,
    execute: async (raw) => {
      const input = raw as CalendarToolEvent & { service: string, calendar: string }
      const provider = await useCalendarProvider(input.service)
      const created = await provider.createEvent(input.calendar, {
        calendar: input.calendar,
        title: input.title,
        start: input.start,
        end: input.end,
        allDay: input.allDay,
        description: input.description,
        location: input.location,
        recurrence: input.recurrence,
        reminders: input.reminders
      })

      if (created.url) {
        await refreshCalendarObject(input.service, input.calendar, created.url)
      }
      await publishDomainEvent({ domain: 'calendar', service: input.service, type: 'changed', resource: input.calendar })

      return { ...created, service: input.service }
    }
  },
  {
    name: 'calendar_update_event',
    domain: 'calendar',
    description: 'Update an event, either one occurrence or the whole recurring series. Pass the event URL from calendar_list_events; times are ISO 8601.',
    input: z.object({
      service: z.string().min(1).describe('Calendar service id'),
      calendar: calendarInput,
      uid: z.string().min(1).describe('iCalendar UID of the event'),
      url: z.string().url().optional().describe('DAV object href from calendar_list_events'),
      etag: z.string().optional().describe('ETag from calendar_list_events, to detect a concurrent change'),
      scope: scopeInput,
      recurrenceId: isoDate.optional().describe('Original start of the occurrence being edited'),
      ...eventFields
    }),
    writes: true,
    execute: async (raw) => {
      const input = raw as CalendarToolEvent & {
        service: string
        calendar: string
        uid: string
        url?: string
        etag?: string
        scope: 'one' | 'all'
        recurrenceId?: string
      }
      const provider = await useCalendarProvider(input.service)

      await provider.updateEvent({
        uid: input.uid,
        calendar: input.calendar,
        url: input.url,
        etag: input.etag,
        recurrenceId: input.recurrenceId,
        title: input.title,
        start: input.start,
        end: input.end,
        allDay: !!input.allDay
      }, {
        title: input.title,
        start: input.start,
        end: input.end,
        allDay: input.allDay,
        description: input.description,
        location: input.location,
        recurrence: input.recurrence,
        reminders: input.reminders
      }, input.scope)

      if (input.url) {
        await refreshCalendarObject(input.service, input.calendar, input.url)
      }
      await publishDomainEvent({ domain: 'calendar', service: input.service, type: 'changed', resource: input.calendar })

      return { ok: true, uid: input.uid, scope: input.scope }
    }
  },
  {
    name: 'calendar_delete_event',
    domain: 'calendar',
    description: 'Delete an event, either one occurrence of a recurring series or the whole series. Requires the URL from calendar_list_events.',
    input: z.object({
      service: z.string().min(1).describe('Calendar service id'),
      calendar: calendarInput,
      uid: z.string().min(1).describe('iCalendar UID of the event'),
      url: z.string().url().describe('DAV object href from calendar_list_events'),
      etag: z.string().optional().describe('ETag from calendar_list_events'),
      scope: scopeInput,
      recurrenceId: isoDate.optional().describe('Original start of the occurrence being deleted')
    }),
    writes: true,
    execute: async (raw) => {
      const input = raw as { service: string, calendar: string, uid: string, url: string, etag?: string, scope: 'one' | 'all', recurrenceId?: string }
      const provider = await useCalendarProvider(input.service)

      await provider.deleteEvent({
        uid: input.uid,
        calendar: input.calendar,
        url: input.url,
        etag: input.etag,
        recurrenceId: input.recurrenceId,
        title: '',
        start: '',
        end: '',
        allDay: false
      }, input.scope)

      if (input.scope === 'one') {
        await refreshCalendarObject(input.service, input.calendar, input.url)
      } else {
        await removeCachedObject(input.service, input.url)
      }
      await publishDomainEvent({ domain: 'calendar', service: input.service, type: 'changed', resource: input.calendar })

      return { ok: true, uid: input.uid, scope: input.scope }
    }
  }
]
