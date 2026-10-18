import { addDays, addWeeks, endOfMonth, startOfMonth, startOfWeek } from 'date-fns'
import { zoned } from './calendar-view'

/** Monday, matching the week grid in most of Europe */
const WEEK_STARTS_ON = 1
/** How far the endless month grid may grow in either direction */
const CAP_WEEKS = 104

/** A run of whole weeks; `end` is the Monday after the last Sunday */
export interface MonthWeekRange {
  start: Date
  end: Date
}

export interface ExtendedMonthWeeks {
  range: MonthWeekRange
  /** The cap was reached, so the range cannot grow any further */
  done: boolean
}

/** The week holding a date, starting on Monday */
function weekOf(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON })
}

/**
 * The weeks the month view opens with: four weeks before the anchor month's
 * first week and eight weeks after its last one.
 */
export function initialWeeks(anchor: Date, timeZone: string): MonthWeekRange {
  const month = zoned(anchor, timeZone)
  const firstWeek = weekOf(startOfMonth(month))
  const lastWeekEnd = addDays(weekOf(endOfMonth(month)), 7)

  return {
    start: addWeeks(firstWeek, -4),
    end: addWeeks(lastWeekEnd, 8)
  }
}

/**
 * Grow a range by whole weeks in one direction. Growth stops 104 weeks before
 * and after today's week; at that cap the range comes back unchanged with
 * `done: true`.
 */
export function extendWeeks(
  range: MonthWeekRange,
  direction: 'past' | 'future',
  weeks = 8,
  today = new Date()
): ExtendedMonthWeeks {
  if (weeks <= 0) {
    return { range, done: true }
  }

  const currentWeek = weekOf(today)

  if (direction === 'past') {
    const limit = addWeeks(currentWeek, -CAP_WEEKS)
    if (range.start.getTime() <= limit.getTime()) {
      return { range, done: true }
    }

    const extended = addWeeks(range.start, -weeks)
    const start = extended.getTime() < limit.getTime() ? limit : extended

    return {
      range: { start, end: range.end },
      done: false
    }
  }

  const limit = addWeeks(currentWeek, CAP_WEEKS + 1)
  if (range.end.getTime() >= limit.getTime()) {
    return { range, done: true }
  }

  const extended = addWeeks(range.end, weeks)
  const end = extended.getTime() > limit.getTime() ? limit : extended

  return {
    range: { start: range.start, end },
    done: false
  }
}

/** The days of a range, as Monday-to-Sunday weeks rendered in `timeZone` */
export function weeksOf(range: MonthWeekRange, timeZone: string): Date[][] {
  const weeks: Date[][] = []

  for (let cursor = range.start; cursor.getTime() < range.end.getTime(); cursor = addWeeks(cursor, 1)) {
    const start = zoned(cursor, timeZone)
    weeks.push(Array.from({ length: 7 }, (_, index) => zoned(addDays(start, index), timeZone)))
  }

  return weeks
}

/**
 * The month most days of a week belong to. Used for the header label while the
 * grid scrolls, so a week split across two months still names one of them.
 */
export function monthAtTop(weeks: Date[][], firstVisibleWeekIndex: number): Date {
  const week = weeks[firstVisibleWeekIndex] ?? weeks[0] ?? []
  const months = new Map<number, { month: Date, count: number }>()

  for (const day of week) {
    const key = day.getFullYear() * 12 + day.getMonth()
    const entry = months.get(key)
    if (entry) {
      entry.count += 1
    } else {
      months.set(key, { month: new Date(day.getFullYear(), day.getMonth(), 1), count: 1 })
    }
  }

  let majority: { month: Date, count: number } | undefined
  for (const entry of months.values()) {
    if (!majority || entry.count > majority.count) {
      majority = entry
    }
  }

  return majority?.month ?? new Date()
}

/** Whether a day is the first of its month */
export function isFirstOfMonth(day: Date): boolean {
  return day.getDate() === 1
}

/** Whether a day belongs to a different month than `month` */
export function isOtherMonth(day: Date, month: Date): boolean {
  return day.getFullYear() !== month.getFullYear() || day.getMonth() !== month.getMonth()
}
