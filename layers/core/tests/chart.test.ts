import { describe, expect, it } from 'vitest'
import type { ActivityDay, DashboardSeries } from '../shared/types/dashboard'
import {
  activityDates,
  activityDomains,
  domainColor,
  domainLabel,
  hasSeriesPoints,
  integerTicks,
  rangeFromQuery,
  seriesTableRows,
  statusColor,
  syncDurationRows,
  warningErrorRows,
  yDomainFromZero
} from '../app/utils/chart'

const day = (date: string, domain: string, patch: Partial<ActivityDay> = {}): ActivityDay => ({
  date,
  domain,
  warnings: 0,
  errors: 0,
  syncRuns: 0,
  medianSyncMs: null,
  ...patch
})

describe('domainColor', () => {
  it('uses the domain token for a known domain', () => {
    expect(domainColor('mail')).toBe('var(--chart-mail)')
    expect(domainColor('calendar')).toBe('var(--chart-calendar)')
    expect(domainColor('documents')).toBe('var(--chart-documents)')
  })

  it('falls back to the core token for an unknown domain', () => {
    expect(domainColor('unknown')).toBe('var(--chart-core)')
    expect(domainColor('')).toBe('var(--chart-core)')
  })

  it('maps the core domain to the core token', () => {
    expect(domainColor('core')).toBe('var(--chart-core)')
  })
})

describe('domainLabel', () => {
  it('capitalises the first letter', () => {
    expect(domainLabel('mail')).toBe('Mail')
    expect(domainLabel('calendar')).toBe('Calendar')
    expect(domainLabel('documents')).toBe('Documents')
    expect(domainLabel('')).toBe('')
  })
})

describe('integerTicks', () => {
  it('shows every integer up to five', () => {
    expect(integerTicks(0)).toEqual([0])
    expect(integerTicks(3)).toEqual([0, 1, 2, 3])
    expect(integerTicks(5)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('uses an integer step above five', () => {
    expect(integerTicks(6)).toEqual([0, 2, 4, 6])
    expect(integerTicks(23)).toEqual([0, 5, 10, 15, 20])
    expect(integerTicks(100)).toEqual([0, 20, 40, 60, 80, 100])
  })

  it('handles a missing maximum', () => {
    expect(integerTicks(Number.NaN)).toEqual([0])
    expect(integerTicks(-4)).toEqual([0])
  })
})

describe('statusColor', () => {
  it('builds the status token', () => {
    expect(statusColor('good')).toBe('var(--status-good)')
    expect(statusColor('critical')).toBe('var(--status-critical)')
  })
})

describe('rangeFromQuery', () => {
  it('accepts the offered ranges', () => {
    expect(rangeFromQuery('7')).toBe(7)
    expect(rangeFromQuery('30')).toBe(30)
    expect(rangeFromQuery('90')).toBe(90)
  })

  it('falls back to 30 for anything else', () => {
    expect(rangeFromQuery('14')).toBe(30)
    expect(rangeFromQuery(undefined)).toBe(30)
    expect(rangeFromQuery(['7', '90'])).toBe(30)
  })
})

describe('hasSeriesPoints', () => {
  it('is false without points', () => {
    expect(hasSeriesPoints(undefined)).toBe(false)
    const series: DashboardSeries = { id: 'a', domain: 'mail', label: 'A', bucket: 'day', points: [] }
    expect(hasSeriesPoints(series)).toBe(false)
  })

  it('is true with points', () => {
    const series: DashboardSeries = { id: 'a', domain: 'mail', label: 'A', bucket: 'day', points: [{ date: '2024-01-01', value: 2 }] }
    expect(hasSeriesPoints(series)).toBe(true)
  })
})

describe('seriesTableRows', () => {
  it('returns the points and an empty list without a series', () => {
    const series: DashboardSeries = { id: 'a', domain: 'mail', label: 'A', bucket: 'day', points: [{ date: '2024-01-01', value: 2 }] }
    expect(seriesTableRows(series)).toEqual([{ date: '2024-01-01', value: 2 }])
    expect(seriesTableRows(undefined)).toEqual([])
  })
})

describe('yDomainFromZero', () => {
  it('starts at zero and leaves headroom above the maximum', () => {
    expect(yDomainFromZero([2.6])).toEqual([0, 2.6 * 1.1])
    expect(yDomainFromZero([1, 4.2, 3])).toEqual([0, 4.2 * 1.1])
  })

  it('falls back to [0, 1] without data', () => {
    expect(yDomainFromZero([])).toEqual([0, 1])
    expect(yDomainFromZero([0])).toEqual([0, 1])
    expect(yDomainFromZero([Number.NaN, Number.POSITIVE_INFINITY])).toEqual([0, 1])
  })
})

describe('activity helpers', () => {
  const days = [
    day('2024-01-02', 'mail', { medianSyncMs: 4000, warnings: 1 }),
    day('2024-01-01', 'mail', { medianSyncMs: 8000, errors: 2 }),
    day('2024-01-01', 'calendar', { medianSyncMs: 2000, warnings: 3 })
  ]

  it('lists domains in first-seen order and dates oldest first', () => {
    expect(activityDomains(days)).toEqual(['mail', 'calendar'])
    expect(activityDates(days)).toEqual(['2024-01-01', '2024-01-02'])
  })

  it('converts sync durations to seconds and keeps a missing day null', () => {
    const { domains, rows } = syncDurationRows(days)
    expect(domains).toEqual(['mail', 'calendar'])
    expect(rows).toEqual([
      { date: '2024-01-01', values: { mail: 8, calendar: 2 } },
      { date: '2024-01-02', values: { mail: 4, calendar: null } }
    ])
  })

  it('sums warnings and errors per day', () => {
    expect(warningErrorRows(days)).toEqual([
      { date: '2024-01-01', values: { warnings: 3, errors: 2 } },
      { date: '2024-01-02', values: { warnings: 1, errors: 0 } }
    ])
  })
})
