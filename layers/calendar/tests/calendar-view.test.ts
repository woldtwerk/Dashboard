import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../shared/types/calendar'
import {
  dateKey,
  eventKey,
  eventOccursOn,
  eventsForDay,
  formatEventStart,
  formatEventTime,
  fromInputValue,
  fromRecurrenceSelect,
  fromReminderSelect,
  groupEventsByDay,
  isSelectedEvent,
  monthGrid,
  recurrenceLabel,
  recurrenceSelectItems,
  reminderSelectItems,
  shiftDate,
  toInputValue,
  toRecurrenceSelect,
  toReminderSelect,
  viewFromQuery,
  viewToQuery,
  viewWindow
} from '../app/utils/calendar-view'

const TZ = 'Europe/Berlin'

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
    const { start, end } = viewWindow('day', new Date('2026-10-16T12:00:00Z'), TZ)
    expect(dateKey(start, TZ)).toBe('2026-10-16')
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('starts a week on Monday', () => {
    const { start, end } = viewWindow('week', new Date('2026-10-16T12:00:00Z'), TZ)
    expect(dateKey(start, TZ)).toBe('2026-10-12')
    expect(dateKey(end, TZ)).toBe('2026-10-19')
  })

  it('covers a month with six weeks', () => {
    const { start, end } = viewWindow('month', new Date('2026-10-16T12:00:00Z'), TZ)
    expect(dateKey(start, TZ)).toBe('2026-09-28')
    expect(dateKey(end, TZ)).toBe('2026-11-09')
    expect(start.getDay()).toBe(1)
  })
})

describe('monthGrid', () => {
  it('is six rows of seven days drawn from the window', () => {
    const grid = monthGrid(new Date('2026-10-16T12:00:00Z'), TZ)
    expect(grid).toHaveLength(6)
    expect(grid.every(week => week.length === 7)).toBe(true)
    expect(dateKey(grid[0]![0]!, TZ)).toBe('2026-09-28')
    expect(dateKey(grid[5]![6]!, TZ)).toBe('2026-11-08')
  })
})

describe('shiftDate', () => {
  it('moves by a view-sized step', () => {
    const anchor = new Date('2026-10-16T12:00:00Z')
    expect(dateKey(shiftDate('month', anchor, 1, TZ), TZ)).toBe('2026-11-16')
    expect(dateKey(shiftDate('week', anchor, -1, TZ), TZ)).toBe('2026-10-09')
    expect(dateKey(shiftDate('day', anchor, 1, TZ), TZ)).toBe('2026-10-17')
  })
})

describe('viewFromQuery', () => {
  const today = new Date('2026-10-16T12:00:00Z')

  it('defaults to the month view on today', () => {
    const state = viewFromQuery({}, TZ, today)
    expect(state.view).toBe('month')
    expect(dateKey(state.date, TZ)).toBe('2026-10-16')
  })

  it('reads a view and an anchor date', () => {
    const { view, date } = viewFromQuery({ view: 'week', date: '2026-03-02' }, TZ, today)
    expect(view).toBe('week')
    expect(dateKey(date, TZ)).toBe('2026-03-02')
  })

  it('ignores an unknown view and a malformed date', () => {
    const state = viewFromQuery({ view: 'decade', date: 'soon' }, TZ, today)
    expect(state.view).toBe('month')
    expect(dateKey(state.date, TZ)).toBe('2026-10-16')
  })

  it('round-trips through the URL', () => {
    const query = Object.fromEntries(Object.entries(viewToQuery({ view: 'day', date: new Date('2026-10-16T12:00:00Z') }, TZ)).filter(([, value]) => value))
    const state = viewFromQuery(query, TZ, today)
    expect(state.view).toBe('day')
    expect(dateKey(state.date, TZ)).toBe('2026-10-16')
  })
})

describe('eventOccursOn', () => {
  it('matches a timed event on its day only', () => {
    const meeting = event('2026-10-16T09:00:00.000Z', '2026-10-16T10:00:00.000Z')
    expect(eventOccursOn(meeting, new Date('2026-10-16T12:00:00Z'), TZ)).toBe(true)
    expect(eventOccursOn(meeting, new Date('2026-10-17T12:00:00Z'), TZ)).toBe(false)
  })

  it('matches a multi-day timed event on every day it covers', () => {
    const trip = event('2026-10-05T00:00:00.000Z', '2026-10-08T00:00:00.000Z')
    expect(eventOccursOn(trip, new Date('2026-10-06T12:00:00Z'), TZ)).toBe(true)
    expect(eventOccursOn(trip, new Date('2026-10-09T12:00:00Z'), TZ)).toBe(false)
  })

  it('keeps a zero-length event on its day', () => {
    const point = event('2026-10-16T09:00:00.000Z', '2026-10-16T09:00:00.000Z')
    expect(eventOccursOn(point, new Date('2026-10-16T12:00:00Z'), TZ)).toBe(true)
    expect(eventOccursOn(point, new Date('2026-10-17T12:00:00Z'), TZ)).toBe(false)
  })

  it('reads an all-day event by its calendar date, not by the shifted instant', () => {
    const day = event('2026-10-16T00:00:00.000Z', '2026-10-17T00:00:00.000Z', true)
    expect(eventOccursOn(day, new Date('2026-10-16T12:00:00Z'), TZ)).toBe(true)
    expect(eventOccursOn(day, new Date('2026-10-17T12:00:00Z'), TZ)).toBe(false)
  })
})

describe('time zone', () => {
  it('renders a UTC instant as wall time in the zone', () => {
    const meeting = event('2026-10-16T11:00:00.000Z', '2026-10-16T12:00:00.000Z')
    expect(formatEventStart(meeting, TZ)).toBe('13:00')
    expect(formatEventTime(meeting, TZ)).toBe('13:00–14:00')
    expect(formatEventTime(meeting, 'UTC')).toBe('11:00–12:00')
  })

  it('lands an event near midnight on the day it starts locally', () => {
    // 00:30 on the 17th in Berlin, 22:30Z on the 16th
    const late = event('2026-10-16T22:30:00.000Z', '2026-10-16T23:30:00.000Z')
    const sixteenth = eventsForDay([late], new Date('2026-10-16T12:00:00Z'), TZ)
    const seventeenth = eventsForDay([late], new Date('2026-10-17T12:00:00Z'), TZ)

    expect(sixteenth).toEqual([])
    expect(seventeenth.map(item => item.uid)).toEqual([late.uid])
  })
})

describe('groupEventsByDay', () => {
  it('buckets events under the days they fall on, all-day first', () => {
    const days = [new Date('2026-10-16T12:00:00Z'), new Date('2026-10-17T12:00:00Z')]
    const groups = groupEventsByDay([
      event('2026-10-16T09:00:00.000Z', '2026-10-16T10:00:00.000Z'),
      event('2026-10-16T00:00:00.000Z', '2026-10-17T00:00:00.000Z', true)
    ], days, TZ)

    expect(groups[0]!.events.map(item => item.allDay)).toEqual([true, false])
    expect(groups[1]!.events).toEqual([])
  })
})

describe('eventsForDay', () => {
  it('sorts timed events by start', () => {
    const day = new Date('2026-10-16T12:00:00Z')
    const events = eventsForDay([
      event('2026-10-16T15:00:00.000Z', '2026-10-16T16:00:00.000Z'),
      event('2026-10-16T09:00:00.000Z', '2026-10-16T10:00:00.000Z')
    ], day, TZ)

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

describe('form value conversion', () => {
  it('reads and writes times in the zone, all-day as UTC midnight', () => {
    expect(toInputValue('2026-10-16T11:00:00.000Z', false, TZ)).toBe('2026-10-16T13:00')
    expect(fromInputValue('2026-10-16T13:00', false, TZ)).toBe('2026-10-16T11:00:00.000Z')
    expect(toInputValue('2026-10-16T00:00:00.000Z', true, TZ)).toBe('2026-10-16')
    expect(fromInputValue('2026-10-16', true, TZ)).toBe('2026-10-16T00:00:00.000Z')
  })
})

describe('recurrence select', () => {
  it('maps the sentinel to no rule and back', () => {
    expect(toRecurrenceSelect(undefined)).toBe('none')
    expect(toRecurrenceSelect('FREQ=WEEKLY')).toBe('FREQ=WEEKLY')
    expect(fromRecurrenceSelect('none')).toBe('')
    expect(fromRecurrenceSelect('FREQ=DAILY')).toBe('FREQ=DAILY')
  })

  it('offers the presets, adding an unlisted rule as custom', () => {
    expect(recurrenceSelectItems(undefined).every(item => !item.label.startsWith('Custom'))).toBe(true)
    expect(recurrenceSelectItems(undefined)[0]!.value).toBe('none')
    expect(recurrenceSelectItems('FREQ=WEEKLY')).toHaveLength(6)
    expect(recurrenceSelectItems('FREQ=HOURLY')).toContainEqual({ label: 'Custom (FREQ=HOURLY)', value: 'FREQ=HOURLY' })
  })
})

describe('reminder select', () => {
  it('maps the sentinel to no reminder and back', () => {
    expect(toReminderSelect(undefined)).toBe('none')
    expect(toReminderSelect(15)).toBe('15')
    expect(fromReminderSelect('none')).toBeUndefined()
    expect(fromReminderSelect('15')).toBe(15)
  })

  it('offers the presets, adding an unlisted offset as custom', () => {
    expect(reminderSelectItems(undefined)[0]!.value).toBe('none')
    expect(reminderSelectItems(15)).toHaveLength(7)
    expect(reminderSelectItems(90)).toContainEqual({ label: 'Custom (90 minutes)', value: '90' })
  })
})

describe('recurrenceLabel', () => {
  it('names the presets and passes unknown rules through', () => {
    expect(recurrenceLabel('')).toBe('Does not repeat')
    expect(recurrenceLabel('FREQ=WEEKLY')).toBe('Weekly')
    expect(recurrenceLabel('FREQ=HOURLY')).toBe('FREQ=HOURLY')
  })
})
