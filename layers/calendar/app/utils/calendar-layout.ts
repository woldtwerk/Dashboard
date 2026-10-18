import { parseISO } from 'date-fns'
import type { CalendarEvent } from '#layers/calendar/shared/types/calendar'
import { dateKey, eventsForDay, eventOccursOn, formatEventStart, startOfZonedDay, zoned } from './calendar-view'

/** Pixels of one hour row in the week and day grids */
export const HOUR_HEIGHT = 48
export const DAY_MINUTES = 24 * 60
/** The grid opens here unless an earlier event pulls the scroll up */
export const DEFAULT_SCROLL_HOUR = 7
/** How many chips a month cell shows before the "+N more" button */
export const MONTH_EVENT_LIMIT = 8
/** A timed event at least this long is shown in the all-day lane, not the grid */
const LONG_EVENT_MS = 24 * 60 * 60 * 1000

export interface PositionedEvent {
  event: CalendarEvent
  top: number
  height: number
  /** Column within the overlap group, 0-based */
  column: number
  /** Columns the overlap group is split into */
  columns: number
}

interface LayoutItem {
  event: CalendarEvent
  startMin: number
  endMin: number
}

/** Whether a timed event spans a full day or more, so it belongs to the lane */
function isLongTimedEvent(event: CalendarEvent): boolean {
  return !event.allDay && parseISO(event.end).getTime() - parseISO(event.start).getTime() >= LONG_EVENT_MS
}

/**
 * Timed events of one day placed on the grid: minutes become pixels through
 * `hourHeight`, an event running past midnight is clipped to the part that
 * falls on `day`, and transitively overlapping events are packed side by side.
 * All-day events and timed ones of a day or more are not part of the grid.
 */
export function layoutDay(events: CalendarEvent[], day: Date, timeZone: string, hourHeight = HOUR_HEIGHT): PositionedEvent[] {
  const dayStart = startOfZonedDay(day, timeZone).getTime()

  const items: LayoutItem[] = events
    .filter(event => !event.allDay && !isLongTimedEvent(event))
    .map((event) => {
      const start = parseISO(event.start).getTime()
      const rawEnd = parseISO(event.end).getTime()
      const end = rawEnd > start ? rawEnd : start + 60_000

      return {
        event,
        startMin: Math.min(DAY_MINUTES, Math.max(0, (start - dayStart) / 60_000)),
        endMin: Math.min(DAY_MINUTES, Math.max(0, (end - dayStart) / 60_000))
      }
    })
    .filter(item => item.endMin > item.startMin)
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)

  const positioned: PositionedEvent[] = []
  let cluster: LayoutItem[] = []
  let clusterEnd = -Infinity

  // A cluster is the run of events that transitively overlap; a greedy pass
  // gives each the first column that is free at its start
  function flush() {
    const columnEnds: number[] = []
    const columns = cluster.map((item) => {
      let index = columnEnds.findIndex(end => end <= item.startMin)
      if (index === -1) {
        index = columnEnds.length
      }
      columnEnds[index] = item.endMin

      return index
    })

    for (const [index, item] of cluster.entries()) {
      positioned.push({
        event: item.event,
        top: item.startMin * hourHeight / 60,
        height: (item.endMin - item.startMin) * hourHeight / 60,
        column: columns[index]!,
        columns: columnEnds.length
      })
    }
  }

  for (const item of items) {
    if (cluster.length && item.startMin >= clusterEnd) {
      flush()
      cluster = []
      clusterEnd = -Infinity
    }

    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.endMin)
  }

  if (cluster.length) {
    flush()
  }

  return positioned
}

/**
 * The hour the day grid opens at: 07:00, pulled up to one hour before the
 * earliest timed event of `day` when that is earlier.
 */
export function initialScrollHour(events: CalendarEvent[], day: Date, timeZone: string): number {
  const earliest = events
    .filter(event => !event.allDay && !isLongTimedEvent(event) && eventOccursOn(event, day, timeZone))
    .reduce<number | undefined>((hour, event) => {
      const start = zoned(parseISO(event.start), timeZone).getHours()
      return hour === undefined || start < hour ? start : hour
    }, undefined)

  return earliest === undefined ? DEFAULT_SCROLL_HOUR : Math.min(DEFAULT_SCROLL_HOUR, Math.max(0, earliest - 1))
}

/**
 * The events the all-day lane shows for `day`: all-day events plus timed ones
 * that span a full day or more and therefore have no place on the grid.
 */
export function allDayLaneEvents(events: CalendarEvent[], day: Date, timeZone: string): CalendarEvent[] {
  return eventsForDay(events, day, timeZone).filter(event => event.allDay || isLongTimedEvent(event))
}

/** A chip label; a long timed event shows its start time on the day it starts */
export function allDayLaneLabel(event: CalendarEvent, day: Date, timeZone: string): string {
  if (event.allDay || dateKey(parseISO(event.start), timeZone) !== dateKey(day, timeZone)) {
    return event.title
  }

  return `${formatEventStart(event, timeZone)} ${event.title}`
}

/** What a month cell shows and what the "+N more" popover holds */
export interface MonthCell {
  visible: CalendarEvent[]
  overflow: CalendarEvent[]
}

/** A day's events, split into the chips a month cell shows and the rest */
export function monthCell(events: CalendarEvent[], day: Date, timeZone: string, limit = MONTH_EVENT_LIMIT): MonthCell {
  const all = eventsForDay(events, day, timeZone)

  return all.length <= limit
    ? { visible: all, overflow: [] }
    : { visible: all.slice(0, limit), overflow: all.slice(limit) }
}
