import ICAL from 'ical.js'
import type { CalendarEvent, CalendarEventInput } from '../../shared/types/calendar'

type IcalComponent = InstanceType<typeof ICAL.Component>
type IcalEvent = InstanceType<typeof ICAL.Event>
type IcalTime = InstanceType<typeof ICAL.Time>

/** Where an iCalendar object came from, filled into every event it yields. */
export interface EventSource {
  url?: string
  etag?: string
  calendar: string
  service?: string
}

/** The half-open window occurrences are selected by: [start, end) */
export interface EventWindow {
  start: Date
  end: Date
}

/** The editable fields of an event; the same shape create and update carry. */
export type EventEdit = Omit<CalendarEventInput, 'calendar'>

// Expansion always starts at DTSTART (passing a start time to the iterator
// resets the time of day), so this bounds how far back a rule may reach before
// the window; a daily rule covers about 27 years.
const MAX_OCCURRENCES = 10_000

/** Parse a VCALENDAR and make its timezones known, so TZID times resolve. */
export function parseCalendar(ics: string): IcalComponent {
  const component = new ICAL.Component(ICAL.parse(ics))

  for (const timezone of component.getAllSubcomponents('vtimezone')) {
    const tzid = timezone.getFirstPropertyValue('tzid')
    if (typeof tzid === 'string' && !ICAL.TimezoneService.has(tzid)) {
      ICAL.TimezoneService.register(timezone)
    }
  }

  return component
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** ISO 8601 of an iCalendar time; date-only values become UTC midnight. */
export function timeToIso(time: IcalTime): string {
  if (time.isDate) {
    return `${time.year}-${pad(time.month)}-${pad(time.day)}T00:00:00.000Z`
  }

  return time.toJSDate().toISOString()
}

function readRrule(event: IcalEvent): string | undefined {
  const property = event.component.getFirstProperty('rrule')
  return property ? String(property.getFirstValue()) : undefined
}

function readReminders(event: IcalEvent): number[] {
  const minutes: number[] = []

  for (const alarm of event.component.getAllSubcomponents('valarm')) {
    const trigger = alarm.getFirstPropertyValue('trigger')
    if (trigger instanceof ICAL.Duration) {
      // A relative trigger is negative before the start; the UI wants minutes before
      minutes.push(Math.round(-trigger.toSeconds() / 60))
    }
  }

  return minutes.sort((a, b) => a - b)
}

function baseEvent(event: IcalEvent, source: EventSource, start: IcalTime, end: IcalTime, recurrenceId?: string): CalendarEvent {
  return {
    uid: event.uid,
    url: source.url,
    etag: source.etag,
    calendar: source.calendar,
    service: source.service,
    title: event.summary || '(no title)',
    description: event.description || undefined,
    location: event.location || undefined,
    start: timeToIso(start),
    end: timeToIso(end),
    allDay: start.isDate,
    recurrence: readRrule(event),
    reminders: readReminders(event),
    recurrenceId
  }
}

/**
 * Events of one iCalendar object that fall in the window. A recurring event is
 * expanded server-side into one entry per occurrence; a non-recurring event is
 * included when it overlaps the window.
 *
 * Overrides (VEVENTs that carry a RECURRENCE-ID) are not listed on their own —
 * the master's expansion resolves them through `getOccurrenceDetails`.
 */
export function expandEvents(ics: string, source: EventSource, window: EventWindow): CalendarEvent[] {
  const calendar = parseCalendar(ics)

  return calendar.getAllSubcomponents('vevent')
    .filter(component => !component.getFirstProperty('recurrence-id'))
    .flatMap((component) => {
      const event = new ICAL.Event(component)
      const results: CalendarEvent[] = []

      if (event.isRecurring()) {
        const expansion = event.iterator()

        for (let count = 0; count < MAX_OCCURRENCES; count++) {
          const occurrence = expansion.next()
          if (!occurrence) {
            break
          }
          if (occurrence.toJSDate() >= window.end) {
            break
          }

          const details = event.getOccurrenceDetails(occurrence)
          if (details.endDate.toJSDate() > window.start && details.startDate.toJSDate() < window.end) {
            results.push({ ...baseEvent(event, source, details.startDate, details.endDate, timeToIso(details.recurrenceId)), recurring: true })
          }
        }

        return results
      }

      const start = event.startDate
      const end = event.endDate
      if (start && end && timeToIso(end) > window.start.toISOString() && timeToIso(start) < window.end.toISOString()) {
        results.push(baseEvent(event, source, start, end))
      }

      return results
    })
}

// --- Editing: patch the existing object instead of rebuilding it, so every
//     property the form does not own survives (organiser, attendees, EXDATEs,
//     categories, X-props, …).

function deepCopy(component: IcalComponent): IcalComponent {
  // toJSON returns the live jCal array, so a structural copy is required
  return new ICAL.Component(JSON.parse(JSON.stringify(component.toJSON())))
}

function findMaster(calendar: IcalComponent): IcalComponent | undefined {
  const events = calendar.getAllSubcomponents('vevent')
  return events.find(component => !component.getFirstProperty('recurrence-id')) ?? events[0]
}

/** The UID of the master event in a calendar object, or undefined. */
export function readEventUid(ics: string): string | undefined {
  const uid = findMaster(parseCalendar(ics))?.getFirstPropertyValue('uid')
  return typeof uid === 'string' ? uid : undefined
}

function timeFromIso(iso: string, allDay: boolean): IcalTime {
  const time = ICAL.Time.fromJSDate(new Date(iso), true)
  if (allDay) {
    time.isDate = true
    time.hour = 0
    time.minute = 0
    time.second = 0
  }
  return time
}

function sameRecurrenceId(component: IcalComponent, recurrenceId: IcalTime): boolean {
  const value = component.getFirstPropertyValue('recurrence-id')
  return value instanceof ICAL.Time && timeToIso(value) === timeToIso(recurrenceId)
}

/** DTEND is exclusive; a same-day all-day edit ends the next day. */
function endDate(edit: EventEdit): Date {
  const start = new Date(edit.start)
  const end = new Date(edit.end)
  return edit.allDay && end <= start ? new Date(start.getTime() + 86_400_000) : end
}

function setText(component: IcalComponent, name: string, value?: string) {
  if (value) {
    component.updatePropertyWithValue(name, value)
  } else {
    component.removeAllProperties(name)
  }
}

function setReminders(component: IcalComponent, edit: EventEdit) {
  if (edit.reminders === undefined) {
    return
  }

  // Replace only the relative DISPLAY alarms the form models; keep the rest
  for (const alarm of component.getAllSubcomponents('valarm').filter(item => item.getFirstPropertyValue('trigger') instanceof ICAL.Duration)) {
    component.removeSubcomponent(alarm)
  }

  for (const minutes of edit.reminders) {
    const alarm = new ICAL.Component('valarm')
    alarm.updatePropertyWithValue('action', 'DISPLAY')
    alarm.updatePropertyWithValue('description', edit.title)
    alarm.updatePropertyWithValue('trigger', ICAL.Duration.fromSeconds(-minutes * 60))
    component.addSubcomponent(alarm)
  }
}

function writeFields(component: IcalComponent, edit: EventEdit, times: { start: Date, end?: Date }, now: Date, withRule: boolean) {
  component.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(now, true))
  component.updatePropertyWithValue('dtstart', timeFromIso(times.start.toISOString(), !!edit.allDay))
  if (times.end) {
    component.updatePropertyWithValue('dtend', timeFromIso(times.end.toISOString(), !!edit.allDay))
  }

  setText(component, 'summary', edit.title)
  setText(component, 'location', edit.location)
  setText(component, 'description', edit.description)

  if (withRule && edit.recurrence !== undefined) {
    // An empty rule removes the recurrence, turning a series into one event
    setText(component, 'rrule', edit.recurrence)
  }

  setReminders(component, edit)
}

/**
 * Rewrite the whole series: the master keeps its identity and every unmanaged
 * property, and its DTSTART/DTEND move by the delta between the occurrence the
 * form was opened at and the new time.
 */
export function applySeriesEdit(ics: string, edit: EventEdit, recurrenceId?: string, now = new Date()): string {
  const calendar = parseCalendar(ics)
  const master = findMaster(calendar)
  if (!master) {
    throw new Error('The calendar object has no event')
  }

  const start = new Date(edit.start)
  let times = { start, end: endDate(edit) }

  const ownStart = master.getFirstPropertyValue('dtstart')
  if (recurrenceId && ownStart instanceof ICAL.Time) {
    const delta = start.getTime() - new Date(recurrenceId).getTime()
    const moved = new Date(new Date(timeToIso(ownStart)).getTime() + delta)
    const ownEnd = master.getFirstPropertyValue('dtend')
    times = {
      start: moved,
      end: ownEnd instanceof ICAL.Time ? new Date(new Date(timeToIso(ownEnd)).getTime() + delta) : times.end
    }
  }

  writeFields(master, edit, times, now, true)

  return serializeCalendar(calendar)
}

/**
 * Change a single occurrence: add or update the override VEVENT that carries
 * the occurrence's original RECURRENCE-ID, leaving the master untouched.
 */
export function applyOccurrenceEdit(ics: string, recurrenceId: string, edit: EventEdit, now = new Date()): string {
  const calendar = parseCalendar(ics)
  const master = findMaster(calendar)
  if (!master) {
    throw new Error('The calendar object has no event')
  }

  const ownStart = master.getFirstPropertyValue('dtstart')
  const allDay = edit.allDay ?? (ownStart instanceof ICAL.Time && ownStart.isDate)
  const id = timeFromIso(recurrenceId, allDay)

  let override = calendar.getAllSubcomponents('vevent').find(component => component !== master && sameRecurrenceId(component, id))
  if (override) {
    override.updatePropertyWithValue('recurrence-id', id)
  } else {
    override = deepCopy(master)
    override.removeAllProperties('rrule')
    override.removeAllProperties('exdate')
    override.removeAllProperties('recurrence-id')
    override.updatePropertyWithValue('recurrence-id', id)
    calendar.addSubcomponent(override)
  }

  writeFields(override, edit, { start: new Date(edit.start), end: endDate(edit) }, now, false)

  return serializeCalendar(calendar)
}

/**
 * Cancel a single occurrence: EXDATE it on the master and drop any override
 * that had changed it.
 */
export function applyOccurrenceDelete(ics: string, recurrenceId: string): string {
  const calendar = parseCalendar(ics)
  const master = findMaster(calendar)
  if (!master) {
    throw new Error('The calendar object has no event')
  }

  const ownStart = master.getFirstPropertyValue('dtstart')
  const allDay = ownStart instanceof ICAL.Time && ownStart.isDate
  const id = timeFromIso(recurrenceId, allDay)

  for (const component of calendar.getAllSubcomponents('vevent')) {
    if (component !== master && sameRecurrenceId(component, id)) {
      calendar.removeSubcomponent(component)
    }
  }

  if (master.getFirstProperty('rrule')) {
    const cancelled = master.getAllProperties('exdate').some((property) => {
      const value = property.getFirstValue()
      return value instanceof ICAL.Time && timeToIso(value) === timeToIso(id)
    })
    if (!cancelled) {
      master.addPropertyWithValue('exdate', id)
    }
  }

  return serializeCalendar(calendar)
}

function serializeCalendar(calendar: IcalComponent): string {
  const text = calendar.toString()
  return /\r?\n$/.test(text) ? text : `${text}\r\n`
}

// --- Creating ---

function escapeText(value: string): string {
  return value.replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, '\\n')
}

function fold(line: string): string {
  const limit = 75
  if (line.length <= limit) {
    return line
  }

  let folded = line.slice(0, limit)
  let rest = line.slice(limit)
  while (rest.length) {
    folded += `\r\n ${rest.slice(0, limit - 1)}`
    rest = rest.slice(limit - 1)
  }

  return folded
}

/** `YYYYMMDD` for a DATE value */
function dateValue(iso: string): string {
  const date = new Date(iso)
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
}

/** `YYYYMMDDTHHMMSSZ` for a UTC DATE-TIME value */
function dateTimeValue(iso: string): string {
  const date = new Date(iso)
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

/**
 * Serialize a new event to a standalone VCALENDAR, so it can be PUT to the DAV
 * collection. Times are written in UTC; the UID is the caller's.
 */
export function serializeEvent(input: EventEdit, uid: string, now = new Date()): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Allmight//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeText(uid)}`,
    `DTSTAMP:${dateTimeValue(now.toISOString())}`
  ]

  if (input.allDay) {
    // DTEND is exclusive; a same-day event ends the next day
    const end = new Date(input.end) > new Date(input.start) ? new Date(input.end) : new Date(new Date(input.start).getTime() + 86_400_000)
    lines.push(`DTSTART;VALUE=DATE:${dateValue(input.start)}`)
    lines.push(`DTEND;VALUE=DATE:${dateValue(end.toISOString())}`)
  } else {
    lines.push(`DTSTART:${dateTimeValue(input.start)}`)
    lines.push(`DTEND:${dateTimeValue(input.end)}`)
  }

  lines.push(fold(`SUMMARY:${escapeText(input.title)}`))

  if (input.description) {
    lines.push(fold(`DESCRIPTION:${escapeText(input.description)}`))
  }
  if (input.location) {
    lines.push(fold(`LOCATION:${escapeText(input.location)}`))
  }
  if (input.recurrence) {
    lines.push(fold(`RRULE:${input.recurrence.replace(/^RRULE:/i, '')}`))
  }

  for (const minutes of input.reminders ?? []) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(input.title)}`,
      `TRIGGER:${minutes >= 0 ? `-PT${minutes}M` : `PT${-minutes}M`}`,
      'END:VALARM'
    )
  }

  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.join('\r\n') + '\r\n'
}
