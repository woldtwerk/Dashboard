import { describe, expect, it } from 'vitest'
import { formatMailFullDate, formatMailListDate } from '../app/utils/mail-date'

describe('formatMailListDate', () => {
  it('renders the same instant differently per zone', () => {
    const date = '2025-03-05T07:38:00Z'
    const now = new Date('2025-03-05T12:00:00Z')

    expect(formatMailListDate(date, 'UTC', now)).toBe('07:38')
    expect(formatMailListDate(date, 'Europe/Berlin', now)).toBe('08:38')
    expect(formatMailListDate(date, 'America/New_York', now)).toBe('02:38')
  })

  it('shows the date once the mail is not from today in the zone', () => {
    const date = '2025-03-04T23:30:00Z'
    const now = new Date('2025-03-05T12:00:00Z')

    // Still 4 March in UTC, already 5 March in Berlin — the row says "today" only in Berlin
    expect(formatMailListDate(date, 'UTC', now)).toBe('04 Mar')
    expect(formatMailListDate(date, 'Europe/Berlin', now)).toBe('00:30')
  })

  it('follows midnight in the zone, not in the process zone', () => {
    // 23:59 Berlin on 4 March, half an hour before "now" in UTC and just past
    // midnight in Berlin
    const date = '2025-03-04T22:59:00Z'
    const now = new Date('2025-03-04T23:30:00Z')

    expect(formatMailListDate(date, 'Europe/Berlin', now)).toBe('04 Mar')
    // In UTC both instants are still 4 March, so the row shows the time
    expect(formatMailListDate(date, 'UTC', now)).toBe('22:59')
  })

  it('accepts a Date as well as an ISO string', () => {
    const now = new Date('2025-03-05T12:00:00Z')
    expect(formatMailListDate(new Date('2025-03-05T07:38:00Z'), 'Europe/Berlin', now)).toBe('08:38')
  })

  it('handles the DST switch', () => {
    // Berlin springs forward at 02:00 on 30 March 2025 (CET → CEST)
    const before = '2025-03-30T00:30:00Z'
    const after = '2025-03-30T01:30:00Z'
    const now = new Date('2025-03-30T12:00:00Z')

    expect(formatMailListDate(before, 'Europe/Berlin', now)).toBe('01:30')
    expect(formatMailListDate(after, 'Europe/Berlin', now)).toBe('03:30')
  })
})

describe('formatMailFullDate', () => {
  it('renders date and time in the zone', () => {
    const date = '2025-03-05T07:38:00Z'

    expect(formatMailFullDate(date, 'UTC')).toBe('05 Mar 2025 07:38')
    expect(formatMailFullDate(date, 'Europe/Berlin')).toBe('05 Mar 2025 08:38')
    expect(formatMailFullDate(date, 'America/New_York')).toBe('05 Mar 2025 02:38')
  })

  it('renders the zone-local calendar day across midnight', () => {
    const date = '2025-03-04T23:30:00Z'

    expect(formatMailFullDate(date, 'UTC')).toBe('04 Mar 2025 23:30')
    expect(formatMailFullDate(date, 'Europe/Berlin')).toBe('05 Mar 2025 00:30')
  })

  it('handles the DST switch', () => {
    expect(formatMailFullDate('2025-03-30T01:30:00Z', 'Europe/Berlin')).toBe('30 Mar 2025 03:30')
    // Autumn: 03:00 CEST → 02:00 CET on 26 October 2025
    expect(formatMailFullDate('2025-10-26T01:30:00Z', 'Europe/Berlin')).toBe('26 Oct 2025 02:30')
  })
})
