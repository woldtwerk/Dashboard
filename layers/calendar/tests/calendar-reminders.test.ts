import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../shared/types/calendar'
import { dueReminders, reminderBody, reminderDedupeKey, reminderLink } from '../server/utils/calendar-reminders'

const event = (start: string, reminders: number[] = [15], extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: 'event@example.com',
  calendar: 'https://dav/cal/',
  title: 'Standup',
  start,
  end: start,
  allDay: false,
  reminders,
  ...extra
})

describe('dueReminders', () => {
  it('finds a reminder that fell in the window', () => {
    const now = new Date('2026-10-20T09:45:00Z')
    const due = dueReminders([event('2026-10-20T10:00:00Z', [15])], now, 2 * 60_000)

    expect(due).toHaveLength(1)
    expect(due[0]?.offset).toBe(15)
  })

  it('ignores a reminder outside the look-back window', () => {
    const now = new Date('2026-10-20T09:50:00Z')
    const due = dueReminders([event('2026-10-20T10:00:00Z', [15])], now, 2 * 60_000)

    expect(due).toEqual([])
  })

  it('returns every offset that is due', () => {
    const now = new Date('2026-10-20T09:00:00Z')
    const due = dueReminders([event('2026-10-20T10:00:00Z', [15, 30, 60])], now, 2 * 60_000)

    expect(due.map(item => item.offset)).toEqual([60])
  })

  it('handles an all-day event with a reminder the previous day', () => {
    const now = new Date('2026-10-19T00:00:00Z')
    const due = dueReminders([event('2026-10-20T00:00:00Z', [1440], { allDay: true })], now, 2 * 60_000)

    expect(due).toHaveLength(1)
    expect(due[0]?.offset).toBe(1440)
  })

  it('subtracts reminders in real minutes across a DST change', () => {
    // Europe/Berlin leaves DST at 01:00 UTC on 2026-10-25
    const now = new Date('2026-10-25T08:00:00Z')
    const due = dueReminders([event('2026-10-25T09:00:00Z', [60])], now, 2 * 60_000)

    expect(due).toHaveLength(1)
    expect(new Date(due[0]!.event.start).toISOString()).toBe('2026-10-25T09:00:00.000Z')
  })

  it('reports a reminder that is due at the start', () => {
    const now = new Date('2026-10-20T10:00:00Z')
    const due = dueReminders([event('2026-10-20T10:00:00Z', [0])], now, 2 * 60_000)

    expect(due.map(item => item.offset)).toEqual([0])
  })

  it('deduplicates repeated offsets', () => {
    const now = new Date('2026-10-20T09:45:00Z')
    const due = dueReminders([event('2026-10-20T10:00:00Z', [15, 15])], now, 2 * 60_000)

    expect(due).toHaveLength(1)
  })

  it('ignores events without reminders', () => {
    const now = new Date('2026-10-20T09:45:00Z')

    expect(dueReminders([event('2026-10-20T10:00:00Z', [])], now, 2 * 60_000)).toEqual([])
  })
})

describe('reminder text', () => {
  it('puts the location after the offset', () => {
    expect(reminderBody(15, 'Office')).toBe('in 15 min · Office')
    expect(reminderBody(5)).toBe('in 5 min')
  })

  it('builds a stable dedupe key', () => {
    expect(reminderDedupeKey('uid', '2026-10-20T10:00:00.000Z', 15))
      .toBe('reminder:uid:2026-10-20T10:00:00.000Z:15')
  })

  it('links a recurring occurrence to its original start', () => {
    const occurrence = event('2026-10-20T10:00:00Z', [15], { recurrenceId: '2026-10-13T10:00:00.000Z' })

    expect(reminderLink(occurrence)).toBe('/calendar?event=event%40example.com&recurrence=2026-10-13T10%3A00%3A00.000Z')
  })
})
