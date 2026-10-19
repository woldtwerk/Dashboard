import { describe, expect, it } from 'vitest'
import { CALENDAR_TOOL_MAX_RANGE_DAYS, calendarEventSources, calendarListSources, toCalendarToolWindow } from '../server/tools'

describe('toCalendarToolWindow', () => {
  it('normalizes a valid window to ISO strings', () => {
    const window = toCalendarToolWindow({ start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-10-31T00:00:00Z') })

    expect(window).toEqual({ start: '2026-10-01T00:00:00.000Z', end: '2026-10-31T00:00:00.000Z' })
  })

  it('rejects a reversed window', () => {
    expect(() => toCalendarToolWindow({ start: new Date('2026-10-02T00:00:00Z'), end: new Date('2026-10-01T00:00:00Z') })).toThrow(/after its start/)
  })

  it(`rejects a window longer than ${CALENDAR_TOOL_MAX_RANGE_DAYS} days`, () => {
    const start = new Date('2026-01-01T00:00:00Z')
    expect(() => toCalendarToolWindow({
      start,
      end: new Date(start.getTime() + (CALENDAR_TOOL_MAX_RANGE_DAYS + 1) * 24 * 60 * 60 * 1000)
    })).toThrow(/at most/)
  })
})

describe('calendar tool sources', () => {
  it('maps an event to an event card with its start as the date', () => {
    const sources = calendarEventSources({ events: [{
      title: 'Concert',
      start: '2026-11-05T19:30:00+01:00',
      end: '2026-11-05T22:00:00+01:00',
      location: 'Stadthalle',
      uid: 'uid-1',
      calendar: 'https://cal.example.com/default',
      service: 'work'
    }] })

    expect(sources).toEqual([{
      kind: 'event',
      title: 'Concert',
      subtitle: 'Stadthalle',
      date: '2026-11-05T19:30:00+01:00',
      link: '/calendar?event=uid-1&recurrence='
    }])
  })

  it('drops an event without the ids its link needs', () => {
    expect(calendarEventSources({ events: [{ title: 'No uid', calendar: 'cal' }] })).toEqual([])
    expect(calendarEventSources(undefined)).toEqual([])
  })

  it('maps calendars to calendar cards', () => {
    const sources = calendarListSources([{ service: 'work', calendars: [{ name: 'Work', serviceName: 'Work CalDAV', hidden: false, url: 'cal' }] }])

    expect(sources).toEqual([{ kind: 'calendar', title: 'Work', subtitle: 'Work CalDAV', link: '/calendar' }])
  })
})
