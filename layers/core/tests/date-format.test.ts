import { describe, expect, it } from 'vitest'
import { formatZoned, isSameZonedDay, startOfZonedDay, zoned } from '../shared/date-format'

describe('formatZoned', () => {
  it('renders the same instant differently per zone', () => {
    const date = '2025-03-05T07:38:00Z'

    expect(formatZoned(date, 'UTC', 'dd MMM yyyy HH:mm')).toBe('05 Mar 2025 07:38')
    expect(formatZoned(date, 'Europe/Berlin', 'dd MMM yyyy HH:mm')).toBe('05 Mar 2025 08:38')
    expect(formatZoned(date, 'America/New_York', 'dd MMM yyyy HH:mm')).toBe('05 Mar 2025 02:38')
  })

  it('renders the zone-local calendar day across midnight', () => {
    const date = '2025-03-04T23:30:00Z'

    expect(formatZoned(date, 'UTC', 'dd MMM yyyy HH:mm')).toBe('04 Mar 2025 23:30')
    expect(formatZoned(date, 'Europe/Berlin', 'dd MMM yyyy HH:mm')).toBe('05 Mar 2025 00:30')
  })

  it('renders a date without the time part', () => {
    expect(formatZoned('2026-10-16T09:30:00Z', 'Europe/Berlin', 'dd MMM yyyy')).toBe('16 Oct 2026')
  })

  it('keeps seconds when the pattern asks for them', () => {
    expect(formatZoned('2026-10-19T09:08:51Z', 'Europe/Berlin', 'dd MMM yyyy HH:mm:ss')).toBe('19 Oct 2026 11:08:51')
  })

  it('accepts a Date as well as an ISO string', () => {
    expect(formatZoned(new Date('2025-03-05T07:38:00Z'), 'Europe/Berlin', 'HH:mm')).toBe('08:38')
  })

  it('handles both DST switches', () => {
    // Berlin springs forward at 02:00 CET on 30 March 2025
    expect(formatZoned('2025-03-30T00:30:00Z', 'Europe/Berlin', 'HH:mm')).toBe('01:30')
    expect(formatZoned('2025-03-30T01:30:00Z', 'Europe/Berlin', 'HH:mm')).toBe('03:30')

    // and falls back at 03:00 CEST on 26 October 2025
    expect(formatZoned('2025-10-26T01:30:00Z', 'Europe/Berlin', 'HH:mm')).toBe('02:30')
  })
})

describe('isSameZonedDay', () => {
  it('follows midnight in the zone, not in the process zone', () => {
    const date = '2025-03-04T22:59:00Z'
    const now = new Date('2025-03-04T23:30:00Z')

    // 23:59 Berlin on 4 March, already 00:30 in Berlin on 5 March
    expect(isSameZonedDay(date, now, 'Europe/Berlin')).toBe(false)
    // Both still 4 March in UTC
    expect(isSameZonedDay(date, now, 'UTC')).toBe(true)
  })

  it('is true for two instants on the same local day', () => {
    expect(isSameZonedDay('2025-03-05T00:00:00Z', '2025-03-05T22:00:00Z', 'Europe/Berlin')).toBe(true)
  })
})

describe('startOfZonedDay', () => {
  it('is local midnight in the zone', () => {
    const start = startOfZonedDay('2025-03-05T07:38:00Z', 'Europe/Berlin')

    expect(start.getFullYear()).toBe(2025)
    expect(start.getMonth()).toBe(2)
    expect(start.getDate()).toBe(5)
    expect(start.getHours()).toBe(0)
    expect(new Date(start.getTime()).toISOString()).toBe('2025-03-04T23:00:00.000Z')
  })
})

describe('zoned', () => {
  it('reads the instant in the zone', () => {
    const date = zoned('2025-03-05T07:38:00Z', 'Europe/Berlin')

    expect(date.getHours()).toBe(8)
    expect(date.getMinutes()).toBe(38)
  })
})
