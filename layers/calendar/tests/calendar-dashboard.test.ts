import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../shared/types/calendar'
import { dashboardWindows, eventsWithin } from '../server/utils/calendar-dashboard'

const event = (overrides: Partial<CalendarEvent>): CalendarEvent => ({
  uid: 'event',
  calendar: 'https://dav.example/work',
  title: 'Event',
  start: '2026-10-18T08:00:00.000Z',
  end: '2026-10-18T09:00:00.000Z',
  allDay: false,
  ...overrides
})

describe('dashboardWindows', () => {
  it('starts both windows at local midnight in the configured zone', () => {
    const windows = dashboardWindows(new Date('2026-10-18T15:00:00.000Z'), 'Europe/Berlin')

    expect(windows.today).toEqual({ start: '2026-10-17T22:00:00.000Z', end: '2026-10-18T22:00:00.000Z' })
    expect(windows.week).toEqual({ start: '2026-10-17T22:00:00.000Z', end: '2026-10-24T22:00:00.000Z' })
  })
})

describe('eventsWithin', () => {
  const window = { start: '2026-10-17T22:00:00.000Z', end: '2026-10-18T22:00:00.000Z' }

  it('keeps events overlapping the window', () => {
    const events = [
      event({ uid: 'inside' }),
      event({ uid: 'overlap', start: '2026-10-17T20:00:00.000Z', end: '2026-10-18T01:00:00.000Z' }),
      event({ uid: 'after', start: '2026-10-18T22:00:00.000Z', end: '2026-10-18T23:00:00.000Z' })
    ]

    expect(eventsWithin(events, window).map(item => item.uid)).toEqual(['inside', 'overlap'])
  })

  it('excludes an event ending exactly at the window start', () => {
    const events = [event({ start: '2026-10-17T20:00:00.000Z', end: '2026-10-17T22:00:00.000Z' })]

    expect(eventsWithin(events, window)).toEqual([])
  })
})
