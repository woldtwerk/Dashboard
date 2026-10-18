import { describe, expect, it } from 'vitest'
import type { LogEntry } from '../shared/types/logs'
import {
  logFetchQuery,
  logLevelMeta,
  logQueryFromRoute,
  logQueryToRoute,
  matchesText,
  mergeLogEntries,
  toLogQueryString
} from '../app/utils/logs'

const entry = (id: number, patch: Partial<LogEntry> = {}): LogEntry => ({
  id,
  at: '2024-01-01T12:00:00Z',
  level: 'info',
  domain: 'mail',
  message: `message ${id}`,
  ...patch
})

describe('logQueryFromRoute', () => {
  it('reads arrays and single values', () => {
    expect(logQueryFromRoute({ domain: ['mail', 'calendar'], level: 'warn', live: '0' })).toEqual({
      domains: ['mail', 'calendar'],
      services: [],
      levels: ['warn'],
      q: '',
      live: false
    })
  })

  it('drops unknown levels and defaults live to on', () => {
    const filters = logQueryFromRoute({ level: ['warn', 'nope', 'error'] })
    expect(filters.levels).toEqual(['warn', 'error'])
    expect(filters.live).toBe(true)
  })
})

describe('logQueryToRoute', () => {
  it('omits empty filters and represents live off', () => {
    expect(logQueryToRoute({ domains: [], services: [], levels: [], q: '  ', live: true })).toEqual({})
    expect(logQueryToRoute({ domains: ['mail'], services: [], levels: ['error'], q: 'boom', live: false })).toEqual({
      domain: ['mail'],
      level: ['error'],
      q: 'boom',
      live: '0'
    })
  })

  it('round-trips the filters', () => {
    const filters = { domains: ['mail'], services: ['acc'], levels: ['warn'] as const, q: 'x', live: false }
    expect(logQueryFromRoute(logQueryToRoute({ ...filters, levels: [...filters.levels] }))).toEqual({
      domains: ['mail'],
      services: ['acc'],
      levels: ['warn'],
      q: 'x',
      live: false
    })
  })
})

describe('logFetchQuery', () => {
  it('omits empty lists and adds pagination', () => {
    const filters = { domains: [], services: ['acc'], levels: [], q: '', live: true }
    expect(logFetchQuery(filters, { before: 42, limit: 20 })).toEqual({
      domains: undefined,
      services: ['acc'],
      levels: undefined,
      before: 42,
      limit: 20
    })
  })
})

describe('toLogQueryString', () => {
  it('serializes lists under their API names', () => {
    const query = toLogQueryString({ domains: ['mail', 'calendar'], levels: ['warn'], before: 42, limit: 20 })
    expect(query).toBe('domains=mail&domains=calendar&levels=warn&before=42&limit=20')
  })

  it('is empty without filters', () => {
    expect(toLogQueryString({})).toBe('')
  })
})

describe('matchesText', () => {
  it('matches on message, service and domain, case insensitively', () => {
    const row = entry(1, { service: 'Work Account' })
    expect(matchesText(row, '')).toBe(true)
    expect(matchesText(row, 'MESSAGE')).toBe(true)
    expect(matchesText(row, 'work')).toBe(true)
    expect(matchesText(row, 'mail')).toBe(true)
    expect(matchesText(row, 'nope')).toBe(false)
  })
})

describe('mergeLogEntries', () => {
  it('dedupes by id and keeps the newest first', () => {
    const merged = mergeLogEntries([entry(1), entry(3)], [entry(2), entry(3, { message: 'updated' })])
    expect(merged.map(item => item.id)).toEqual([3, 2, 1])
    expect(merged[0]!.message).toBe('updated')
  })

  it('caps the list at the given size', () => {
    const merged = mergeLogEntries([entry(1)], [entry(2), entry(3), entry(4)], 2)
    expect(merged.map(item => item.id)).toEqual([4, 3])
  })
})

describe('logLevelMeta', () => {
  it('maps levels to a badge tone, icon and status color', () => {
    expect(logLevelMeta('warn')).toMatchObject({ label: 'Warning', tone: 'warning', color: 'var(--status-warning)' })
    expect(logLevelMeta('error')).toMatchObject({ label: 'Error', tone: 'error', color: 'var(--status-critical)' })
    expect(logLevelMeta('info').tone).toBe('neutral')
  })
})
