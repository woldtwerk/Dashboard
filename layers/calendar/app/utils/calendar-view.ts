import { TZDate } from '@date-fns/tz'
import { addDays, addMonths, addWeeks, format, isValid, parseISO, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import type { CalendarEvent } from '#layers/calendar/shared/types/calendar'

export type CalendarView = 'month' | 'week' | 'day' | 'agenda'

export const CALENDAR_VIEWS: { label: string, value: CalendarView }[] = [
  { label: 'Month', value: 'month' },
  { label: 'Week', value: 'week' },
  { label: 'Day', value: 'day' },
  { label: 'Agenda', value: 'agenda' }
]

/** Monday, matching the week grid in most of Europe */
const WEEK_STARTS_ON = 1
const AGENDA_DAYS = 30

/** URL query of the calendar page; every key is optional */
export type CalendarQuery = Record<string, string | null | undefined | (string | null)[]>

/** A `Date` whose parts and formatting are read in `timeZone`. */
export function zoned(date: Date | number, timeZone: string): TZDate {
  return new TZDate(date instanceof Date ? date.getTime() : date, timeZone)
}

/**
 * An instant as a UTC ISO string. `TZDate.toISOString` keeps the zone offset,
 * which compares and sorts wrong against the server's UTC values, so every
 * instant that leaves the view is normalised first.
 */
export function toIso(date: Date | number): string {
  return new Date(date instanceof Date ? date.getTime() : date).toISOString()
}

/** Local midnight of `date`'s day in `timeZone`. */
export function startOfZonedDay(date: Date | number, timeZone: string): TZDate {
  const zonedDate = zoned(date, timeZone)
  return new TZDate(zonedDate.getFullYear(), zonedDate.getMonth(), zonedDate.getDate(), timeZone)
}

/** `hour:00` on the day of `date`, read in `timeZone`. */
export function zonedHour(date: Date | number, hour: number, timeZone: string): TZDate {
  const zonedDate = zoned(date, timeZone)
  return new TZDate(zonedDate.getFullYear(), zonedDate.getMonth(), zonedDate.getDate(), hour, 0, 0, 0, timeZone)
}

export function dateKey(date: Date, timeZone: string): string {
  return format(zoned(date, timeZone), 'yyyy-MM-dd')
}

/** The window a view shows and fetches: [start, end) */
export function viewWindow(view: CalendarView, date: Date, timeZone: string): { start: Date, end: Date } {
  const anchor = zoned(date, timeZone)

  switch (view) {
    case 'day':
      return dayWindow(anchor)
    case 'week': {
      const start = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON })
      return { start, end: addDays(start, 7) }
    }
    case 'agenda': {
      const start = startOfDay(anchor)
      return { start, end: addDays(start, AGENDA_DAYS) }
    }
    default: {
      // Six weeks, so every month fits whatever day it starts on
      const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON })
      return { start, end: addDays(start, 42) }
    }
  }
}

function dayWindow(date: Date): { start: Date, end: Date } {
  const start = startOfDay(date)
  return { start, end: addDays(start, 1) }
}

/** Move the anchor a page forward (1) or back (-1) for the current view */
export function shiftDate(view: CalendarView, date: Date, direction: number, timeZone: string): Date {
  const anchor = zoned(date, timeZone)

  switch (view) {
    case 'day':
      return addDays(anchor, direction)
    case 'week':
      return addWeeks(anchor, direction)
    case 'agenda':
      return addDays(anchor, AGENDA_DAYS * direction)
    default:
      return addMonths(anchor, direction)
  }
}

/** The six-week grid of the month view, as rows of days */
export function monthGrid(date: Date, timeZone: string): Date[][] {
  const { start } = viewWindow('month', date, timeZone)
  const weeks: Date[][] = []

  for (let week = 0; week < 6; week++) {
    weeks.push(Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)))
  }

  return weeks
}

function parseDate(value: string | null | undefined, timeZone: string): TZDate | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new TZDate(year!, month! - 1, day!, timeZone)

  return isValid(date) ? date : undefined
}

export interface CalendarViewQuery {
  view: CalendarView
  date: Date
}

/** The view and anchor date from the URL; defaults to today in `timeZone` */
export function viewFromQuery(query: CalendarQuery, timeZone: string, today = new Date()): CalendarViewQuery {
  const value = typeof query.view === 'string' ? query.view : ''
  const view = CALENDAR_VIEWS.some(item => item.value === value) ? value as CalendarView : 'month'
  const date = parseDate(typeof query.date === 'string' ? query.date : undefined, timeZone)

  return { view, date: date ?? zoned(today, timeZone) }
}

export function viewToQuery({ view, date }: CalendarViewQuery, timeZone: string): Record<string, string | null> {
  return { view: view === 'month' ? null : view, date: dateKey(date, timeZone) }
}

/** Whether an event overlaps the calendar day, read in `timeZone` */
export function eventOccursOn(event: CalendarEvent, day: Date, timeZone: string): boolean {
  // All-day events are stored as UTC-midnight DATE values; their own calendar
  // date is authoritative, not the instant a time zone would shift it to
  if (event.allDay) {
    const dayValue = dateKey(day, timeZone)
    return dayValue >= event.start.slice(0, 10) && dayValue < event.end.slice(0, 10)
  }

  const start = parseISO(event.start).getTime()
  const rawEnd = parseISO(event.end).getTime()
  const end = rawEnd > start ? rawEnd : start + 1
  const dayStart = startOfZonedDay(day, timeZone).getTime()

  return end > dayStart && start < addDays(startOfZonedDay(day, timeZone), 1).getTime()
}

/** Stable key for an event; occurrences of a series share a UID. */
export function eventKey(event: Pick<CalendarEvent, 'uid' | 'recurrenceId'>): string {
  return `${event.uid}@${event.recurrenceId ?? ''}`
}

/** Whether an expanded occurrence is the one the URL addresses. */
export function isSelectedEvent(event: CalendarEvent, uid?: string, recurrenceId?: string): boolean {
  return !!uid && event.uid === uid && (event.recurrenceId ?? undefined) === (recurrenceId || undefined)
}

export function eventsForDay(events: CalendarEvent[], day: Date, timeZone: string): CalendarEvent[] {
  return events
    .filter(event => eventOccursOn(event, day, timeZone))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))
}

export interface CalendarDay {
  day: Date
  events: CalendarEvent[]
}

/** The agenda: each day of the window with the events that fall on it */
export function groupEventsByDay(events: CalendarEvent[], days: Date[], timeZone: string): CalendarDay[] {
  return days.map(day => ({ day, events: eventsForDay(events, day, timeZone) }))
}

const TIME = 'HH:mm'

/** The start time of an event, as wall time in `timeZone` */
export function formatEventStart(event: CalendarEvent, timeZone: string): string {
  return format(zoned(parseISO(event.start), timeZone), TIME)
}

export function formatEventTime(event: CalendarEvent, timeZone: string): string {
  if (event.allDay) {
    return 'All day'
  }

  const start = zoned(parseISO(event.start), timeZone)
  const end = zoned(parseISO(event.end), timeZone)

  return `${format(start, TIME)}–${format(end, TIME)}`
}

const DATE_FORMAT = 'yyyy-MM-dd'
const DATE_TIME_FORMAT = 'yyyy-MM-dd\'T\'HH:mm'

/**
 * An ISO instant as the `date`/`datetime-local` value the editor shows, read as
 * wall time in `timeZone` so an 11:00Z event reads 13:00 in Europe/Berlin.
 */
export function toInputValue(iso: string, allDay: boolean, timeZone: string): string {
  return format(zoned(parseISO(iso), timeZone), allDay ? DATE_FORMAT : DATE_TIME_FORMAT)
}

/**
 * The instant a form value names. A timed value is wall time in `timeZone`; an
 * all-day value stays UTC midnight, the convention DATE values are stored in.
 */
export function fromInputValue(value: string, allDay: boolean, timeZone: string): string {
  if (allDay) {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`).toISOString()
  }

  const [date, time = '00:00'] = value.split('T')
  const [year, month, day] = date!.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)

  return toIso(new TZDate(year!, month! - 1, day!, hour!, minute!, 0, 0, timeZone))
}

/** The select value standing in for "no recurrence"; Reka rejects an empty one */
export const RECURRENCE_NONE = 'none'

/** Basic recurrence rules the editor offers */
export const RECURRENCE_PRESETS: { label: string, value: string }[] = [
  { label: 'Does not repeat', value: RECURRENCE_NONE },
  { label: 'Daily', value: 'FREQ=DAILY' },
  { label: 'Weekly', value: 'FREQ=WEEKLY' },
  { label: 'Every two weeks', value: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Monthly', value: 'FREQ=MONTHLY' },
  { label: 'Yearly', value: 'FREQ=YEARLY' }
]

/** An RRULE as the select value: empty means the sentinel, the rest pass through */
export function toRecurrenceSelect(recurrence?: string): string {
  return recurrence || RECURRENCE_NONE
}

/** The RRULE a select value stands for; the sentinel clears it */
export function fromRecurrenceSelect(value: string): string {
  return value === RECURRENCE_NONE ? '' : value
}

/** The preset items, plus a custom one so an unlisted rule is shown and kept */
export function recurrenceSelectItems(recurrence?: string): { label: string, value: string }[] {
  const select = toRecurrenceSelect(recurrence)
  if (RECURRENCE_PRESETS.some(item => item.value === select)) {
    return RECURRENCE_PRESETS
  }

  return [...RECURRENCE_PRESETS, { label: `Custom (${select})`, value: select }]
}

/** A human label for an RRULE value, falling back to the raw rule */
export function recurrenceLabel(recurrence?: string): string {
  if (!recurrence) {
    return 'Does not repeat'
  }

  return RECURRENCE_PRESETS.find(item => item.value === recurrence)?.label ?? recurrence
}

/** The select value standing in for "no reminder"; Reka rejects an empty one */
export const REMINDER_NONE = 'none'

/** Reminder offsets the editor offers, in minutes before the start */
export const REMINDER_PRESETS: { label: string, value: string }[] = [
  { label: 'None', value: REMINDER_NONE },
  { label: 'At start', value: '0' },
  { label: '5 minutes before', value: '5' },
  { label: '15 minutes before', value: '15' },
  { label: '30 minutes before', value: '30' },
  { label: '1 hour before', value: '60' },
  { label: '1 day before', value: '1440' }
]

/** A reminder offset as the select value: no reminder is the sentinel */
export function toReminderSelect(minutes?: number): string {
  return minutes === undefined ? REMINDER_NONE : String(minutes)
}

/** The offset a select value stands for; the sentinel clears it */
export function fromReminderSelect(value: string): number | undefined {
  return value === REMINDER_NONE ? undefined : Number(value)
}

/** The preset items, plus a custom one so an unlisted offset is kept */
export function reminderSelectItems(minutes?: number): { label: string, value: string }[] {
  const select = toReminderSelect(minutes)
  if (REMINDER_PRESETS.some(item => item.value === select)) {
    return REMINDER_PRESETS
  }

  return [...REMINDER_PRESETS, { label: `Custom (${select} minutes)`, value: select }]
}
