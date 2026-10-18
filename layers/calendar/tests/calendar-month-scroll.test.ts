import { describe, expect, it } from 'vitest'
import { TZDate } from '@date-fns/tz'
import { addWeeks, startOfWeek } from 'date-fns'
import { dateKey } from '../app/utils/calendar-view'
import {
  extendWeeks,
  initialWeeks,
  isFirstOfMonth,
  isOtherMonth,
  monthAtTop,
  weeksOf
} from '../app/utils/calendar-month-scroll'

const TZ = 'Europe/Berlin'
// October is UTC+2 in Berlin
const day = (value: number, month = 9) => new TZDate(2026, month, value, TZ)
const keys = (dates: Date[]) => dates.map(date => dateKey(date, TZ))

describe('initialWeeks', () => {
  it('starts four weeks before the anchor month and ends eight weeks after it', () => {
    const range = initialWeeks(day(16), TZ)

    // October 2026 starts on a Thursday: its first week is 28 Sep - 4 Oct
    expect(dateKey(range.start, TZ)).toBe('2026-08-31')
    expect(dateKey(range.end, TZ)).toBe('2026-12-28')
  })

  it('covers the first week of the anchor month on a month starting on Monday', () => {
    // June 2026 starts on a Monday
    const range = initialWeeks(day(15, 5), TZ)

    expect(dateKey(range.start, TZ)).toBe('2026-05-04')
    expect(dateKey(range.end, TZ)).toBe('2026-08-31')
  })
})

describe('weeksOf', () => {
  const range = initialWeeks(day(16), TZ)
  const weeks = weeksOf(range, TZ)

  it('renders every week of the range, Monday to Sunday', () => {
    expect(weeks).toHaveLength(17)
    expect(keys(weeks[0]!)).toEqual([
      '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'
    ])
    expect(keys(weeks.at(-1)!)).toEqual([
      '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27'
    ])
  })

  it('returns zone-aware dates', () => {
    expect(weeks[0]![0]).toBeInstanceOf(TZDate)
  })
})

describe('extendWeeks', () => {
  const today = day(16)
  const range = initialWeeks(today, TZ)

  it('adds eight weeks to the future end', () => {
    const { range: next, done } = extendWeeks(range, 'future', 8, today)

    expect(done).toBe(false)
    expect(dateKey(next.start, TZ)).toBe(dateKey(range.start, TZ))
    expect(dateKey(next.end, TZ)).toBe('2027-02-22')
  })

  it('adds eight weeks to the past start', () => {
    const { range: next, done } = extendWeeks(range, 'past', 8, today)

    expect(done).toBe(false)
    expect(dateKey(next.start, TZ)).toBe('2026-07-06')
    expect(dateKey(next.end, TZ)).toBe(dateKey(range.end, TZ))
  })

  it('stops 104 weeks before today', () => {
    const limit = addWeeks(startOfWeek(today, { weekStartsOn: 1 }), -104)
    const capped = { start: limit, end: range.end }

    const { range: next, done } = extendWeeks(capped, 'past', 8, today)

    expect(done).toBe(true)
    expect(next).toBe(capped)
  })

  it('clamps a past extension at the cap', () => {
    const limit = addWeeks(startOfWeek(today, { weekStartsOn: 1 }), -104)
    const near = { start: addWeeks(limit, 2), end: range.end }

    const { range: next } = extendWeeks(near, 'past', 8, today)

    expect(dateKey(next.start, TZ)).toBe(dateKey(limit, TZ))
  })

  it('stops 104 weeks after today', () => {
    const limit = addWeeks(startOfWeek(today, { weekStartsOn: 1 }), 105)
    const capped = { start: range.start, end: limit }

    const { range: next, done } = extendWeeks(capped, 'future', 8, today)

    expect(done).toBe(true)
    expect(next).toBe(capped)
  })

  it('clamps a future extension at the cap', () => {
    const limit = addWeeks(startOfWeek(today, { weekStartsOn: 1 }), 105)
    const near = { start: range.start, end: addWeeks(limit, -2) }

    const { range: next } = extendWeeks(near, 'future', 8, today)

    expect(dateKey(next.end, TZ)).toBe(dateKey(limit, TZ))
  })
})

describe('monthAtTop', () => {
  const weeks = weeksOf(initialWeeks(day(16), TZ), TZ)

  it('picks the month most days of the week belong to', () => {
    // 28 Sep - 4 Oct: three September days against four October days. It is
    // the fifth week of the initial range.
    expect(monthsOf(monthAtTop(weeks, 4))).toBe('2026-10')
    // 21 - 27 September belongs to September alone
    expect(monthsOf(monthAtTop(weeks, 3))).toBe('2026-09')
    // 26 October - 1 November: six October days, one November day
    expect(monthsOf(monthAtTop(weeks, 8))).toBe('2026-10')
  })

  it('falls back to the first week when the index is out of range', () => {
    expect(monthAtTop(weeks, 999)).toEqual(monthAtTop(weeks, 0))
  })
})

describe('month boundary helpers', () => {
  it('detects the first day of a month', () => {
    expect(isFirstOfMonth(day(1))).toBe(true)
    expect(isFirstOfMonth(day(2))).toBe(false)
  })

  it('detects days outside the named month', () => {
    const october = day(1)

    expect(isOtherMonth(day(16), october)).toBe(false)
    expect(isOtherMonth(new TZDate(2026, 10, 1, TZ), october)).toBe(true)
    expect(isOtherMonth(new TZDate(2027, 9, 1, TZ), october)).toBe(true)
  })
})

function monthsOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
