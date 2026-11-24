import { describe, expect, it } from 'vitest'
import { formatRelative, formatUntil } from '../app/utils/time'

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

describe('formatUntil', () => {
  const now = new Date('2024-01-01T12:00:00Z')

  it('handles the near future', () => {
    expect(formatUntil('2024-01-01T12:00:30Z', now)).toBe('now')
    expect(formatUntil('2024-01-01T12:01:15Z', now)).toBe('in 1 min')
    expect(formatUntil('2024-01-01T12:02:00Z', now)).toBe('in 2 min')
    expect(formatUntil('2024-01-01T12:10:00Z', now)).toBe('in 10 min')
  })

  it('handles hours and days', () => {
    expect(formatUntil('2024-01-01T13:00:00Z', now)).toBe('in 1 hour')
    expect(formatUntil('2024-01-01T16:00:00Z', now)).toBe('in 4 hours')
    expect(formatUntil('2024-01-02T18:00:00Z', now)).toBe('tomorrow')
    expect(formatUntil('2024-01-05T12:00:00Z', now)).toBe('in 4 days')
  })

  it('handles months and years', () => {
    expect(formatUntil('2024-02-01T12:00:00Z', now)).toBe('in 1 month')
    expect(formatUntil('2024-05-01T12:00:00Z', now)).toBe('in 4 months')
    expect(formatUntil('2025-02-01T12:00:00Z', now)).toBe('in 1 year')
    expect(formatUntil('2026-01-01T12:00:00Z', now)).toBe('in 2 years')
  })

  it('handles missing, unparsable and past values', () => {
    expect(formatUntil(null, now)).toBe('unknown')
    expect(formatUntil(undefined, now)).toBe('unknown')
    expect(formatUntil('not a date', now)).toBe('unknown')
    expect(formatUntil('2024-01-01T11:59:00Z', now)).toBe('now')
  })
})
