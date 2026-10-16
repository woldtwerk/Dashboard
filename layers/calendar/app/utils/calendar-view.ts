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

export function dateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** The window a view shows and fetches: [start, end) */
export function viewWindow(view: CalendarView, date: Date): { start: Date, end: Date } {
  switch (view) {
    case 'day':
      return dayWindow(date)
    case 'week': {
      const start = startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON })
      return { start, end: addDays(start, 7) }
    }
    case 'agenda': {
      const start = startOfDay(date)
      return { start, end: addDays(start, AGENDA_DAYS) }
    }
    default: {
      // Six weeks, so every month fits whatever day it starts on
      const start = startOfWeek(startOfMonth(date), { weekStartsOn: WEEK_STARTS_ON })
      return { start, end: addDays(start, 42) }
    }
  }
}

function dayWindow(date: Date): { start: Date, end: Date } {
  const start = startOfDay(date)
  return { start, end: addDays(start, 1) }
}

/** Move the anchor a page forward (1) or back (-1) for the current view */
export function shiftDate(view: CalendarView, date: Date, direction: number): Date {
  switch (view) {
    case 'day':
      return addDays(date, direction)
    case 'week':
      return addWeeks(date, direction)
    case 'agenda':
      return addDays(date, AGENDA_DAYS * direction)
    default:
      return addMonths(date, direction)
  }
}

/** The six-week grid of the month view, as rows of days */
export function monthGrid(date: Date): Date[][] {
  const { start } = viewWindow('month', date)
  const weeks: Date[][] = []

  for (let week = 0; week < 6; week++) {
    weeks.push(Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)))
  }

  return weeks
}

function parseDate(value?: string | null): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined
  }

  const date = parseISO(value)
  return isValid(date) ? date : undefined
}

export interface CalendarViewQuery {
  view: CalendarView
  date: Date
}

/** The view and anchor date from the URL; defaults to this month */
export function viewFromQuery(query: CalendarQuery, today = new Date()): CalendarViewQuery {
  const value = typeof query.view === 'string' ? query.view : ''
  const view = CALENDAR_VIEWS.some(item => item.value === value) ? value as CalendarView : 'month'

  return { view, date: parseDate(typeof query.date === 'string' ? query.date : undefined) ?? today }
}

export function viewToQuery({ view, date }: CalendarViewQuery): Record<string, string | null> {
  return { view: view === 'month' ? null : view, date: dateKey(date) }
}

/** Whether an event overlaps the calendar day */
export function eventOccursOn(event: CalendarEvent, day: Date): boolean {
  const start = parseISO(event.start)
  const rawEnd = parseISO(event.end)
  const end = rawEnd > start ? rawEnd : new Date(start.getTime() + 1)

  return end > startOfDay(day) && start < addDays(startOfDay(day), 1)
}

/** Stable key for an event; occurrences of a series share a UID. */
export function eventKey(event: Pick<CalendarEvent, 'uid' | 'recurrenceId'>): string {
  return `${event.uid}@${event.recurrenceId ?? ''}`
}

/** Whether an expanded occurrence is the one the URL addresses. */
export function isSelectedEvent(event: CalendarEvent, uid?: string, recurrenceId?: string): boolean {
  return !!uid && event.uid === uid && (event.recurrenceId ?? undefined) === (recurrenceId || undefined)
}

export function eventsForDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events
    .filter(event => eventOccursOn(event, day))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))
}

export interface CalendarDay {
  day: Date
  events: CalendarEvent[]
}

/** The agenda: each day of the window with the events that fall on it */
export function groupEventsByDay(events: CalendarEvent[], days: Date[]): CalendarDay[] {
  return days.map(day => ({ day, events: eventsForDay(events, day) }))
}

const TIME = 'HH:mm'

export function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) {
    return 'All day'
  }

  return `${format(parseISO(event.start), TIME)}–${format(parseISO(event.end), TIME)}`
}

/** Basic recurrence rules the editor offers */
export const RECURRENCE_PRESETS: { label: string, value: string }[] = [
  { label: 'Does not repeat', value: '' },
  { label: 'Daily', value: 'FREQ=DAILY' },
  { label: 'Weekly', value: 'FREQ=WEEKLY' },
  { label: 'Every two weeks', value: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Monthly', value: 'FREQ=MONTHLY' },
  { label: 'Yearly', value: 'FREQ=YEARLY' }
]

/** A human label for an RRULE value, falling back to the raw rule */
export function recurrenceLabel(recurrence?: string): string {
  if (!recurrence) {
    return 'Does not repeat'
  }

  return RECURRENCE_PRESETS.find(item => item.value === recurrence)?.label ?? recurrence
}
