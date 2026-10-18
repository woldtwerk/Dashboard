import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dashboardServiceStatus,
  fillBuckets,
  getDashboardSeries,
  listDashboardMetrics,
  listDashboardSeries,
  registerDashboardSource,
  resetDashboardSources,
  shouldLogAgain,
  weekStart
} from '../server/utils/dashboard'
import type { ServiceInfo } from '../shared/types/setup'

const service: ServiceInfo = {
  id: 'service-1',
  connector: 'test',
  domain: 'test',
  name: 'Test service'
}

interface StoredValue {
  value: unknown
  ttl?: number
}

let stored: Map<string, StoredValue>

function memoryStorage() {
  return {
    getMounts: () => [],
    getItem: async (key: string) => stored.get(key)?.value ?? null,
    setItem: async (key: string, value: unknown, options?: { ttl?: number }) => {
      stored.set(key, { value, ttl: options?.ttl })
    }
  }
}

beforeEach(() => {
  stored = new Map()
  resetDashboardSources()
  vi.stubGlobal('useStorage', () => memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fillBuckets', () => {
  const today = new Date('2026-10-18T15:00:00.000Z')

  it('fills every day, oldest first, with missing days as zero', () => {
    expect(fillBuckets([
      { date: '2026-10-16', value: 2 },
      { date: '2026-10-18', value: 1 }
    ], 4, 'day', today)).toEqual([
      { date: '2026-10-15', value: 0 },
      { date: '2026-10-16', value: 2 },
      { date: '2026-10-17', value: 0 },
      { date: '2026-10-18', value: 1 }
    ])
  })

  it('sums duplicate dates and ignores points before the window', () => {
    expect(fillBuckets([
      { date: '2026-10-17', value: 2 },
      { date: '2026-10-17', value: 3 },
      { date: '2026-10-01', value: 9 }
    ], 2, 'day', today)).toEqual([
      { date: '2026-10-17', value: 5 },
      { date: '2026-10-18', value: 0 }
    ])
  })

  it('starts week buckets on Monday', () => {
    expect(weekStart(today).toISOString().slice(0, 10)).toBe('2026-10-12')

    expect(fillBuckets([
      { date: '2026-10-05', value: 1 },
      { date: '2026-10-12', value: 3 }
    ], 28, 'week', today)).toEqual([
      { date: '2026-09-21', value: 0 },
      { date: '2026-09-28', value: 0 },
      { date: '2026-10-05', value: 1 },
      { date: '2026-10-12', value: 3 }
    ])
  })

  it('drops weekly points outside the requested span', () => {
    const points = fillBuckets([
      { date: '2026-07-27', value: 4 },
      { date: '2026-10-12', value: 1 }
    ], 7, 'week', today)

    expect(points).toEqual([{ date: '2026-10-12', value: 1 }])
  })
})

describe('listDashboardMetrics', () => {
  it('caches the metrics of a domain for two minutes', async () => {
    const metrics = vi.fn(async () => [{
      id: 'test-count',
      domain: 'test',
      label: 'Test count',
      value: 3
    }])
    registerDashboardSource('test', { metrics })

    expect(await listDashboardMetrics()).toEqual([{ id: 'test-count', domain: 'test', label: 'Test count', value: 3 }])
    expect(await listDashboardMetrics()).toEqual([{ id: 'test-count', domain: 'test', label: 'Test count', value: 3 }])

    expect(metrics).toHaveBeenCalledTimes(1)
    expect(stored.get('dashboard:metrics:test')?.ttl).toBe(120)
  })

  it('warns and skips a failing source', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDashboardSource('broken', {
      metrics: async () => {
        throw new Error('unavailable')
      }
    })
    registerDashboardSource('working', {
      metrics: async () => [{ id: 'ok', domain: 'working', label: 'OK', value: 1 }]
    })

    expect(await listDashboardMetrics()).toEqual([{ id: 'ok', domain: 'working', label: 'OK', value: 1 }])
    expect(warn).toHaveBeenCalledWith('[dashboard] Metrics of "broken" are unavailable:', expect.any(Error))
  })
})

describe('getDashboardSeries', () => {
  it('lists metadata and caches points per day range', async () => {
    const points = vi.fn(async (days: number) => [{ date: '2026-10-18', value: days }])
    registerDashboardSource('test', {
      series: {
        'test-series': { info: { label: 'Test series', bucket: 'day' }, points }
      }
    })

    expect(listDashboardSeries()).toEqual([{ id: 'test-series', domain: 'test', label: 'Test series', bucket: 'day' }])
    expect(await getDashboardSeries('test-series', 7)).toMatchObject({ points: [{ date: '2026-10-18', value: 7 }] })
    expect(await getDashboardSeries('test-series', 7)).toMatchObject({ points: [{ date: '2026-10-18', value: 7 }] })
    expect(await getDashboardSeries('test-series', 30)).toMatchObject({ points: [{ date: '2026-10-18', value: 30 }] })

    expect(points).toHaveBeenCalledTimes(2)
    expect(stored.get('dashboard:series:test:test-series:7')?.ttl).toBe(600)
  })

  it('returns empty points and warns when the source fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDashboardSource('test', {
      series: {
        'broken-series': {
          info: { label: 'Broken', bucket: 'day' },
          points: async () => { throw new Error('unavailable') }
        }
      }
    })

    expect(await getDashboardSeries('broken-series', 7)).toEqual({
      id: 'broken-series',
      domain: 'test',
      label: 'Broken',
      bucket: 'day',
      points: []
    })
    expect(warn).toHaveBeenCalled()
  })

  it('returns undefined for an unknown id', async () => {
    expect(await getDashboardSeries('unknown', 30)).toBeUndefined()
  })
})

describe('shouldLogAgain', () => {
  const interval = 5 * 60_000

  it('logs without a previous failure and after the interval', () => {
    expect(shouldLogAgain(undefined, 1_000, interval)).toBe(true)
    expect(shouldLogAgain(null, 1_000, interval)).toBe(true)
    expect(shouldLogAgain(1_000, 1_000 + interval, interval)).toBe(true)
  })

  it('stays quiet within the interval', () => {
    expect(shouldLogAgain(1_000, 1_000 + interval - 1, interval)).toBe(false)
    expect(shouldLogAgain(1_000, 2_000, interval)).toBe(false)
  })
})

describe('dashboardServiceStatus', () => {
  it('merges the domain status with the service identity', async () => {
    registerDashboardSource('test', {
      status: async () => ({ health: 'ok', syncedAt: '2026-10-18T10:00:00.000Z' })
    })

    expect(await dashboardServiceStatus(service)).toEqual({
      id: 'service-1',
      name: 'Test service',
      domain: 'test',
      icon: undefined,
      health: 'ok',
      syncedAt: '2026-10-18T10:00:00.000Z'
    })
  })

  it('reports unknown without a source', async () => {
    expect(await dashboardServiceStatus({ ...service, domain: 'unknown' })).toMatchObject({ health: 'unknown', syncedAt: null })
  })

  it('reports unknown when the source times out', async () => {
    registerDashboardSource('test', {
      status: () => new Promise(() => {})
    })

    await expect(dashboardServiceStatus(service, 5)).resolves.toMatchObject({ health: 'unknown', syncedAt: null })
  })

  it('reports unknown when the source throws', async () => {
    registerDashboardSource('test', {
      status: async () => { throw new Error('down') }
    })

    await expect(dashboardServiceStatus(service)).resolves.toMatchObject({ health: 'unknown', syncedAt: null })
  })
})
