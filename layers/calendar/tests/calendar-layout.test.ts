import { describe, expect, it } from 'vitest'
import { TZDate } from '@date-fns/tz'
import type { CalendarEvent } from '../shared/types/calendar'
import { HOUR_HEIGHT, allDayLaneEvents, allDayLaneLabel, initialScrollHour, layoutDay, monthCell } from '../app/utils/calendar-layout'

const TZ = 'Europe/Berlin'
// October is UTC+2 in Berlin
const day = (value: number) => new TZDate(2026, 9, value, TZ)

const event = (start: string, end: string, allDay = false): CalendarEvent => ({
  uid: `${start}@x`,
  calendar: 'c',
  title: 'x',
  start,
  end,
  allDay
})

describe('layoutDay', () => {
  it('places non-overlapping events at full width', () => {
    const positioned = layoutDay([
      event('2026-10-16T07:00:00.000Z', '2026-10-16T08:00:00.000Z'),
      event('2026-10-16T09:00:00.000Z', '2026-10-16T10:00:00.000Z')
    ], day(16), TZ)

    expect(positioned).toHaveLength(2)
    expect(positioned[0]).toMatchObject({ top: 9 * HOUR_HEIGHT, height: HOUR_HEIGHT, column: 0, columns: 1 })
    expect(positioned[1]).toMatchObject({ top: 11 * HOUR_HEIGHT, height: HOUR_HEIGHT, column: 0, columns: 1 })
  })

  it('splits two overlapping events into two columns', () => {
    const positioned = layoutDay([
      event('2026-10-16T07:00:00.000Z', '2026-10-16T08:00:00.000Z'),
      event('2026-10-16T07:30:00.000Z', '2026-10-16T08:30:00.000Z')
    ], day(16), TZ)

    expect(positioned[0]).toMatchObject({ top: 9 * HOUR_HEIGHT, column: 0, columns: 2 })
    expect(positioned[1]).toMatchObject({ top: 9.5 * HOUR_HEIGHT, column: 1, columns: 2 })
  })

  it('packs a transitive chain back into a freed column', () => {
    const positioned = layoutDay([
      event('2026-10-16T07:00:00.000Z', '2026-10-16T08:00:00.000Z'),
      event('2026-10-16T07:30:00.000Z', '2026-10-16T08:30:00.000Z'),
      event('2026-10-16T08:15:00.000Z', '2026-10-16T09:15:00.000Z')
    ], day(16), TZ)

    expect(positioned).toHaveLength(3)
    expect(positioned[2]).toMatchObject({ column: 0, columns: 2 })
    expect(positioned.every(item => item.columns === 2)).toBe(true)
  })

  it('clips an event crossing midnight to each day it covers', () => {
    const overnight = event('2026-10-16T21:00:00.000Z', '2026-10-16T23:00:00.000Z')

    const firstDay = layoutDay([overnight], day(16), TZ)
    const secondDay = layoutDay([overnight], day(17), TZ)

    expect(firstDay[0]).toMatchObject({ top: 23 * HOUR_HEIGHT, height: HOUR_HEIGHT })
    expect(secondDay[0]).toMatchObject({ top: 0, height: HOUR_HEIGHT })
  })

  it('leaves all-day events out of the timed grid', () => {
    expect(layoutDay([
      event('2026-10-16T00:00:00.000Z', '2026-10-17T00:00:00.000Z', true)
    ], day(16), TZ)).toEqual([])
  })

  it('leaves a timed event of a day or more out of the grid', () => {
    expect(layoutDay([
      event('2026-10-16T07:00:00.000Z', '2026-10-17T07:00:00.000Z')
    ], day(16), TZ)).toEqual([])
  })

  it('keeps an event just under a day on the grid', () => {
    expect(layoutDay([
      event('2026-10-16T07:00:00.000Z', '2026-10-17T06:00:00.000Z')
    ], day(16), TZ)).toHaveLength(1)
  })
})

describe('allDayLaneEvents', () => {
  const allDay = event('2026-10-16T00:00:00.000Z', '2026-10-17T00:00:00.000Z', true)
  const longTimed = event('2026-10-16T00:30:00.000Z', '2026-10-17T01:00:00.000Z')
  const shortTimed = event('2026-10-16T07:00:00.000Z', '2026-10-16T08:00:00.000Z')

  it('shows all-day events and timed ones of a day or more', () => {
    const lane = allDayLaneEvents([allDay, longTimed, shortTimed], day(16), TZ)
    expect(lane.map(item => item.uid)).toEqual([allDay.uid, longTimed.uid])
  })

  it('leaves out a long timed event on a day it does not reach', () => {
    expect(allDayLaneEvents([longTimed], day(18), TZ)).toEqual([])
  })

  it('labels a long timed event with its start time on its first day only', () => {
    expect(allDayLaneLabel(longTimed, day(16), TZ)).toBe('02:30 x')
    expect(allDayLaneLabel(longTimed, day(17), TZ)).toBe('x')
  })

  it('labels an all-day event without a time', () => {
    expect(allDayLaneLabel(allDay, day(16), TZ)).toBe('x')
  })
})

describe('initialScrollHour', () => {
  it('opens at 07:00 without events', () => {
    expect(initialScrollHour([], day(16), TZ)).toBe(7)
  })

  it('stays at 07:00 for an event later in the day', () => {
    expect(initialScrollHour([event('2026-10-16T07:00:00.000Z', '2026-10-16T08:00:00.000Z')], day(16), TZ)).toBe(7)
  })

  it('pulls up to an hour before an early event', () => {
    expect(initialScrollHour([event('2026-10-16T04:00:00.000Z', '2026-10-16T05:00:00.000Z')], day(16), TZ)).toBe(5)
  })

  it('clamps to midnight for an event just after it', () => {
    expect(initialScrollHour([event('2026-10-15T22:30:00.000Z', '2026-10-15T23:00:00.000Z')], day(16), TZ)).toBe(0)
  })

  it('ignores all-day events', () => {
    expect(initialScrollHour([
      event('2026-10-16T00:00:00.000Z', '2026-10-17T00:00:00.000Z', true)
    ], day(16), TZ)).toBe(7)
  })
})

describe('monthCell', () => {
  const events = [
    event('2026-10-16T07:00:00.000Z', '2026-10-16T08:00:00.000Z'),
    event('2026-10-16T08:00:00.000Z', '2026-10-16T09:00:00.000Z'),
    event('2026-10-16T09:00:00.000Z', '2026-10-16T10:00:00.000Z'),
    event('2026-10-16T10:00:00.000Z', '2026-10-16T11:00:00.000Z')
  ]

  it('shows everything while it fits', () => {
    expect(monthCell(events.slice(0, 2), day(16), TZ).overflow).toEqual([])
  })

  it('folds the rest behind the more button', () => {
    const cell = monthCell(events, day(16), TZ)
    expect(cell.visible).toHaveLength(3)
    expect(cell.overflow).toHaveLength(1)
  })
})
