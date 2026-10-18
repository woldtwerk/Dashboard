import { describe, expect, it } from 'vitest'
import type { DashboardSeries } from '../shared/types/dashboard'
import {
  domainColor,
  hasSeriesPoints,
  integerTicks,
  rangeFromQuery,
  seriesTableRows
} from '../app/utils/chart'

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
