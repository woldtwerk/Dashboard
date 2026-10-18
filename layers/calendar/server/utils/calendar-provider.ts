import { randomUUID } from 'node:crypto'
import { createError } from 'nuxt/server'
import { createDAVClient } from 'tsdav'
import type { DAVCalendar } from 'tsdav'
import type { SetupValues } from '../../../core/shared/types/setup'
import { isUrlWithin, sameOrigin, sameResolvedUrl, sameUrl } from '../../../core/server/utils/url'
import type { Calendar, CalendarEvent, CalendarEventInput, EventScope } from '../../shared/types/calendar'
import type { EventEdit } from './calendar-ical'
import { applyOccurrenceDelete, applyOccurrenceEdit, applySeriesEdit, expandEvents, readEventUid, serializeEvent } from './calendar-ical'

type DavClient = Awaited<ReturnType<typeof createDAVClient>>

/** The DAV credentials every connector stores, whatever signed the account in. */
interface DavSettings {
  url: string
  username: string
  password: string
}

function toDavSettings(values: SetupValues): DavSettings {
  return {
    url: String(values.url ?? '').replace(/\/+$/, ''),
    username: String(values.username ?? ''),
    password: String(values.password ?? '')
  }
}

/** Port a calendar adapter implements; the generic CalDAV one is below. */
export interface CalendarProvider {
  listCalendars(): Promise<Calendar[]>
  /** Events in the half-open window [start, end); recurrences are expanded */
  listEvents(calendarUrl: string, window: { start: string, end: string }): Promise<CalendarEvent[]>
  createEvent(calendarUrl: string, input: CalendarEventInput): Promise<CalendarEvent>
  /** Patch an existing object; `scope` picks the occurrence or the whole series */
  updateEvent(event: CalendarEvent, edit: EventEdit, scope: EventScope): Promise<void>
  deleteEvent(event: CalendarEvent, scope: EventScope): Promise<void>
}

async function createClient(settings: DavSettings): Promise<DavClient> {
  if (!settings.url || !settings.username || !settings.password) {
    throw createError({ status: 503, statusText: 'CalDAV credentials are missing' })
  }

  try {
    return await createDAVClient({
      serverUrl: settings.url,
      credentials: { username: settings.username, password: settings.password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav'
    })
  } catch (error) {
    throw createError({ status: 502, statusText: 'Could not reach the CalDAV server', cause: error })
  }
}

/** tsdav hands back `{ '#text': … }` for some properties; unwrap it */
function toText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value || undefined
  }
  if (value && typeof value === 'object' && '#text' in value) {
    return String((value as { '#text': unknown })['#text'])
  }
  return undefined
}

function toCalendar(collection: DAVCalendar, service: string): Calendar {
  return {
    url: collection.url,
    name: toText(collection.displayName) ?? collection.url.split('/').filter(Boolean).at(-1) ?? 'Calendar',
    color: collection.calendarColor,
    description: toText(collection.description),
    components: collection.components,
    hidden: false,
    service
  }
}

function checkResponse(response: Response, action: string): void {
  if (response.ok) {
    return
  }
  const status = response.status === 412 ? 409 : 502
  throw createError({ status, statusText: `Could not ${action} (${response.status})` })
}

/** A DAV filename for a UID; the UID may contain characters a path cannot. */
function objectName(uid: string): string {
  return `${uid.replace(/[^A-Za-z0-9._@-]/g, '_')}.ics`
}

export function createCalDavProvider(values: SetupValues, service = ''): CalendarProvider {
  const settings = toDavSettings(values)

  // One discovery and one collection listing per provider, which the API
  // creates once per service per request; requests never share them.
  let connecting: Promise<DavClient> | undefined
  let listing: Promise<DAVCalendar[]> | undefined

  const connect = () => (connecting ??= createClient(settings))
  const calendarList = () => (listing ??= connect().then(client => client.fetchCalendars()))

  async function resolve(calendarUrl: string): Promise<DAVCalendar> {
    const found = (await calendarList()).find(collection => sameUrl(collection.url, calendarUrl))
    if (!found) {
      throw createError({ status: 404, statusText: 'Calendar not found' })
    }
    return found
  }

  /**
   * The object URL came from the client. It is only handed to an authenticated
   * request once it is proven to sit inside this calendar on the stored host,
   * so the DAV password cannot be sent to a host the user did not configure.
   */
  function trustedObjectUrl(calendar: DAVCalendar, url: string | undefined): string {
    if (!url || !sameOrigin(settings.url, url) || !isUrlWithin(calendar.url, url)) {
      throw createError({ status: 400, statusText: 'The event URL is not part of this calendar' })
    }
    return url
  }

  /**
   * The object the URL names, and only that one. A server that ignores the
   * multiget filter returns other objects too; taking the first of them would
   * let the edit overwrite an unrelated event, so a miss is a 404.
   */
  async function fetchObject(client: DavClient, calendar: DAVCalendar, url: string, expectedUid: string) {
    const objects = await client.fetchCalendarObjects({ calendar, objectUrls: [url], urlFilter: () => true })
    const object = objects.find(item => sameResolvedUrl(calendar.url, url, item.url))
    if (!object || !object.data) {
      throw createError({ status: 404, statusText: 'Event not found' })
    }

    const data = String(object.data)
    if (readEventUid(data) !== expectedUid) {
      throw createError({ status: 409, statusText: 'The event at that URL is not the expected one' })
    }

    return { data, etag: object.etag }
  }

  return {
    async listCalendars() {
      const calendars = await calendarList()

      return calendars
        .filter(collection => !collection.components || collection.components.includes('VEVENT'))
        .map(collection => toCalendar(collection, service))
    },

    async listEvents(calendarUrl, window) {
      const client = await connect()
      const calendar = await resolve(calendarUrl)
      const objects = await client.fetchCalendarObjects({
        calendar,
        timeRange: { start: window.start, end: window.end },
        // carbonate's object URLs are not always `.ics`; take what the query returns
        urlFilter: () => true
      })

      return objects.flatMap(object => expandEvents(String(object.data ?? ''), {
        url: object.url,
        etag: object.etag,
        calendar: calendar.url
      }, { start: new Date(window.start), end: new Date(window.end) }))
    },

    async createEvent(calendarUrl, input) {
      const client = await connect()
      const calendar = await resolve(calendarUrl)
      const uid = `${randomUUID()}@allmight`
      const data = serializeEvent(input, uid)

      const response = await client.createCalendarObject({ calendar, iCalString: data, filename: objectName(uid) })
      checkResponse(response, 'create the event')

      return {
        uid,
        calendar: calendar.url,
        title: input.title,
        description: input.description,
        location: input.location,
        start: input.start,
        end: input.end,
        allDay: !!input.allDay,
        recurrence: input.recurrence,
        reminders: input.reminders,
        url: `${calendar.url.replace(/\/+$/, '')}/${objectName(uid)}`
      }
    },

    async updateEvent(event, edit, scope) {
      const client = await connect()
      const calendar = await resolve(event.calendar)
      const url = trustedObjectUrl(calendar, event.url)
      const existing = await fetchObject(client, calendar, url, event.uid)
      const recurrenceId = event.recurrenceId ?? event.start

      const data = scope === 'one'
        ? applyOccurrenceEdit(existing.data, recurrenceId, edit)
        : applySeriesEdit(existing.data, edit, event.recurrenceId)

      const response = await client.updateCalendarObject({
        calendarObject: { url, etag: existing.etag ?? event.etag, data }
      })
      checkResponse(response, 'update the event')
    },

    async deleteEvent(event, scope) {
      const client = await connect()
      const calendar = await resolve(event.calendar)
      const url = trustedObjectUrl(calendar, event.url)

      if (scope === 'one') {
        const existing = await fetchObject(client, calendar, url, event.uid)
        const data = applyOccurrenceDelete(existing.data, event.recurrenceId ?? event.start)
        const response = await client.updateCalendarObject({
          calendarObject: { url, etag: existing.etag ?? event.etag, data }
        })
        checkResponse(response, 'delete the occurrence')
        return
      }

      const response = await client.deleteCalendarObject({ calendarObject: { url, etag: event.etag } })
      if (!response.ok && response.status !== 404) {
        checkResponse(response, 'delete the event')
      }
    }
  }
}

/** Opens a CalDAV connection and lists calendars, to verify stored credentials. */
export async function testCalDavConnection(values: SetupValues): Promise<void> {
  const provider = createCalDavProvider(values)
  await provider.listCalendars()
}

/** Creates a provider for one configured calendar service. */
export async function useCalendarProvider(serviceId: string): Promise<CalendarProvider> {
  const service = await getService(serviceId, 'calendar')

  return createCalDavProvider(service.values, serviceId)
}
