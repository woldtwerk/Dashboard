import { describe, expect, it } from 'vitest'
import { CALENDAR_TOOL_MAX_RANGE_DAYS, toCalendarToolWindow } from '../server/tools'

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
