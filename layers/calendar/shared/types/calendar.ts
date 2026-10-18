/** A calendar collection on a CalDAV server. */
export interface Calendar {
  /** DAV collection URL; unique within the service */
  url: string
  name: string
  color?: string
  description?: string
  /** Supported iCalendar components, e.g. VEVENT, VTODO */
  components?: string[]
  /** Hidden in the calendar view; persisted server side */
  hidden: boolean
  /** Collection tag; changes whenever an object in the calendar changes */
  ctag?: string
  /** WebDAV sync token, when the server offers one */
  syncToken?: string
  /** Service that owns the calendar */
  service: string
  serviceName?: string
  icon?: string
}

/** A calendar event, either stored or expanded from a recurrence. */
export interface CalendarEvent {
  /** iCalendar UID */
  uid: string
  /** DAV object href; needed to update or delete */
  url?: string
  etag?: string
  /** DAV collection URL the event lives in */
  calendar: string
  /** Service that owns the calendar */
  service?: string
  title: string
  description?: string
  location?: string
  /** ISO 8601 */
  start: string
  /** ISO 8601 */
  end: string
  allDay: boolean
  /** RRULE value without the `RRULE:` prefix */
  recurrence?: string
  /** Reminder offsets in minutes before the start */
  reminders?: number[]
  /** True for an occurrence expanded from a recurring master */
  recurring?: boolean
  /** Original start of an expanded occurrence; addresses it within the series */
  recurrenceId?: string
}

/** Which part of a recurring event an edit or delete applies to. */
export type EventScope = 'one' | 'all'

/** The events that create or update an event needs. */
export interface CalendarEventInput {
  calendar: string
  title: string
  start: string
  end: string
  allDay?: boolean
  description?: string
  location?: string
  recurrence?: string
  reminders?: number[]
}

/** Calendars of one service, or its error */
export interface CalendarList {
  service: { id: string, name: string, icon?: string }
  calendars: Calendar[]
  error?: string
}

/** Which calendars the calendar page shows */
export interface CalendarSelection {
  service: string
  calendar: string
}

/** Background sync state of one calendar service */
export interface CalendarSyncStatus {
  service: string
  /** A sync is running on some worker */
  syncing: boolean
  /** ISO time of the last completed sync; null before the first one */
  syncedAt: string | null
  /** Last sync error, if the most recent run failed */
  error?: string
}
