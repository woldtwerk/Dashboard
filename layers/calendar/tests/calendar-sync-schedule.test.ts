import { describe, expect, it } from 'vitest'
import { CALENDAR_CACHE_VERSION, isCalendarSyncStale } from '../server/utils/calendar-sync'
import { CALENDAR_SYNC_STALE_MS } from '../shared/sync-schedule'

const now = new Date('2026-10-20T12:00:00.000Z').getTime()
const fresh = { syncedAt: new Date(now - 1_000), version: CALENDAR_CACHE_VERSION }

describe('isCalendarSyncStale', () => {
  it('treats a service that never synced as stale', () => {
    expect(isCalendarSyncStale(undefined, now)).toBe(true)
    expect(isCalendarSyncStale({ syncedAt: null, version: CALENDAR_CACHE_VERSION }, now)).toBe(true)
  })

  it('refetches a cache stored by an older version', () => {
    expect(isCalendarSyncStale({ ...fresh, version: CALENDAR_CACHE_VERSION - 1 }, now)).toBe(true)
    expect(isCalendarSyncStale({ syncedAt: new Date(now), version: null }, now)).toBe(true)
  })

  it('keeps a fresh current cache', () => {
    expect(isCalendarSyncStale(fresh, now)).toBe(false)
    expect(isCalendarSyncStale({ ...fresh, syncedAt: new Date(now - CALENDAR_SYNC_STALE_MS) }, now)).toBe(false)
  })

  it('refetches once the window has passed', () => {
    expect(isCalendarSyncStale({ ...fresh, syncedAt: new Date(now - CALENDAR_SYNC_STALE_MS - 1) }, now)).toBe(true)
  })
})
