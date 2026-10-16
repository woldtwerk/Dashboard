import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../shared/types/calendar'
import { dateKey, eventKey, eventOccursOn, eventsForDay, groupEventsByDay, isSelectedEvent, monthGrid, recurrenceLabel, shiftDate, viewFromQuery, viewToQuery, viewWindow } from '../app/utils/calendar-view'

const event = (start: string, end: string, allDay = false): CalendarEvent => ({
  uid: `${start}@x`,
  calendar: 'c',
  title: 'x',
  start,
  end,
  allDay
})

describe('viewWindow', () => {
  it('spans a single day', () => {
    const { start, end } = viewWindow('day', new Date(2026, 9, 16, 12))
    expect(dateKey(start)).toBe('2026-10-16')
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('starts a week on Monday', () => {
    const { start, end } = viewWindow('week', new Date(2026, 9, 16))
    expect(dateKey(start)).toBe('2026-10-12')
    expect((end.getTime() - start.getTime()) / 86_400_000).toBe(7)
  })

  it('covers a month with six weeks', () => {
    const { start, end } = viewWindow('month', new Date(2026, 9, 16))
    expect((end.getTime() - start.getTime()) / 86_400_000).toBe(42)
    expect(start.getDay()).toBe(1)
  })
})

describe('monthGrid', () => {
  it('is six rows of seven days drawn from the window', () => {
    const grid = monthGrid(new Date(2026, 9, 16))
    expect(grid).toHaveLength(6)
    expect(grid.every(week => week.length === 7)).toBe(true)
    expect(dateKey(grid[0]![0]!)).toBe('2026-09-28')
    expect(dateKey(grid[5]![6]!)).toBe('2026-11-08')
  })
})

describe('shiftDate', () => {
  it('moves by a view-sized step', () => {
    expect(dateKey(shiftDate('month', new Date(2026, 9, 16), 1))).toBe('2026-11-16')
    expect(dateKey(shiftDate('week', new Date(2026, 9, 16), -1))).toBe('2026-10-09')
    expect(dateKey(shiftDate('day', new Date(2026, 9, 16), 1))).toBe('2026-10-17')
  })
})

describe('viewFromQuery', () => {
  const today = new Date(2026, 9, 16)

  it('defaults to the month view on today', () => {
    expect(viewFromQuery({}, today)).toEqual({ view: 'month', date: today })
  })

  it('reads a view and an anchor date', () => {
    const { view, date } = viewFromQuery({ view: 'week', date: '2026-03-02' }, today)
    expect(view).toBe('week')
    expect(dateKey(date)).toBe('2026-03-02')
  })

  it('ignores an unknown view and a malformed date', () => {
    expect(viewFromQuery({ view: 'decade', date: 'soon' }, today)).toEqual({ view: 'month', date: today })
  })

  it('round-trips through the URL', () => {
    const query = Object.fromEntries(Object.entries(viewToQuery({ view: 'day', date: new Date(2026, 9, 16) })).filter(([, value]) => value))
    expect(viewFromQuery(query, today)).toEqual({ view: 'day', date: new Date(2026, 9, 16) })
  })
})

describe('eventOccursOn', () => {
  it('matches a timed event on its day only', () => {
    const meeting = event('2026-10-16T09:00:00.000Z', '2026-10-16T10:00:00.000Z')
    expect(eventOccursOn(meeting, new Date(Date.UTC(2026, 9, 16, 12)))).toBe(true)
    expect(eventOccursOn(meeting, new Date(Date.UTC(2026, 9, 17, 12)))).toBe(false)
  })

  it('matches an all-day event and a multi-day one on every day it covers', () => {
    const trip = event('2026-10-05T00:00:00.000Z', '2026-10-08T00:00:00.000Z')
    expect(eventOccursOn(trip, new Date(Date.UTC(2026, 9, 6, 12)))).toBe(true)
    expect(eventOccursOn(trip, new Date(Date.UTC(2026, 9, 8, 12)))).toBe(false)
  })

  it('keeps a zero-length event on its day', () => {
    const point = event('2026-10-16T09:00:00.000Z', '2026-10-16T09:00:00.000Z')
    expect(eventOccursOn(point, new Date(Date.UTC(2026, 9, 16, 12)))).toBe(true)
  })
})

describe('groupEventsByDay', () => {
  it('buckets events under the days they fall on, all-day first', () => {
    const days = [new Date(Date.UTC(2026, 9, 16)), new Date(Date.UTC(2026, 9, 17))]
    const groups = groupEventsByDay([
      event('2026-10-16T09:00:00.000Z', '2026-10-16T10:00:00.000Z'),
      event('2026-10-16T00:00:00.000Z', '2026-10-17T00:00:00.000Z', true)
    ], days)

    expect(groups[0]!.events.map(item => item.allDay)).toEqual([true, false])
    expect(groups[1]!.events).toEqual([])
  })
})

describe('eventsForDay', () => {
  it('sorts timed events by start', () => {
    const day = new Date(Date.UTC(2026, 9, 16))
    const events = eventsForDay([
      event('2026-10-16T15:00:00.000Z', '2026-10-16T16:00:00.000Z'),
      event('2026-10-16T09:00:00.000Z', '2026-10-16T10:00:00.000Z')
    ], day)

    expect(events.map(item => item.start)).toEqual(['2026-10-16T09:00:00.000Z', '2026-10-16T15:00:00.000Z'])
  })
})

describe('eventKey and isSelectedEvent', () => {
  it('tells occurrences of one series apart', () => {
    const first = { ...event('2026-10-01T09:00:00.000Z', '2026-10-01T09:30:00.000Z'), recurrenceId: '2026-10-01T09:00:00.000Z' }
    const second = { ...event('2026-10-02T09:00:00.000Z', '2026-10-02T09:30:00.000Z'), recurrenceId: '2026-10-02T09:00:00.000Z' }

    expect(eventKey(first)).not.toBe(eventKey(second))
    expect(isSelectedEvent(first, '2026-10-01T09:00:00.000Z@x', '2026-10-01T09:00:00.000Z')).toBe(true)
    expect(isSelectedEvent(second, '2026-10-01T09:00:00.000Z@x', '2026-10-01T09:00:00.000Z')).toBe(false)
  })

  it('matches a plain event with no recurrence id', () => {
    const plain = event('2026-10-16T09:00:00.000Z', '2026-10-16T10:00:00.000Z')
    expect(isSelectedEvent(plain, '2026-10-16T09:00:00.000Z@x', undefined)).toBe(true)
  })
})

describe('recurrenceLabel', () => {
  it('names the presets and passes unknown rules through', () => {
    expect(recurrenceLabel('')).toBe('Does not repeat')
    expect(recurrenceLabel('FREQ=WEEKLY')).toBe('Weekly')
    expect(recurrenceLabel('FREQ=HOURLY')).toBe('FREQ=HOURLY')
  })
})
