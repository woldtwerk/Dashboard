import { describe, expect, it } from 'vitest'
import { formatRelative } from '../app/utils/time'

describe('formatRelative', () => {
  const now = new Date('2024-01-01T12:00:00Z')

  it('handles the recent past', () => {
    expect(formatRelative('2024-01-01T11:59:40Z', now)).toBe('just now')
    expect(formatRelative('2024-01-01T11:58:30Z', now)).toBe('2 min ago')
    expect(formatRelative('2024-01-01T11:58:45Z', now)).toBe('1 min ago')
    expect(formatRelative('2024-01-01T11:50:00Z', now)).toBe('10 min ago')
  })

  it('handles hours and days', () => {
    expect(formatRelative('2024-01-01T11:00:00Z', now)).toBe('1 hour ago')
    expect(formatRelative('2024-01-01T08:00:00Z', now)).toBe('4 hours ago')
    expect(formatRelative('2023-12-31T06:00:00Z', now)).toBe('yesterday')
    expect(formatRelative('2023-12-28T12:00:00Z', now)).toBe('4 days ago')
  })

  it('handles months and years', () => {
    expect(formatRelative('2023-12-01T12:00:00Z', now)).toBe('1 month ago')
    expect(formatRelative('2023-09-01T12:00:00Z', now)).toBe('4 months ago')
    expect(formatRelative('2022-12-01T12:00:00Z', now)).toBe('1 year ago')
  })

  it('handles missing and unparsable values', () => {
    expect(formatRelative(null, now)).toBe('never')
    expect(formatRelative(undefined, now)).toBe('never')
    expect(formatRelative('not a date', now)).toBe('unknown')
  })

  it('treats a future timestamp as just now', () => {
    expect(formatRelative('2024-01-01T12:00:30Z', now)).toBe('just now')
  })
})
