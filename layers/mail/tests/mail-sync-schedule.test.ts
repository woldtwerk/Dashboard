import { describe, expect, it } from 'vitest'
import { isMailSyncStale } from '../server/utils/mail-sync'
import { MAIL_SYNC_STALE_MS } from '../shared/sync-schedule'

const now = new Date('2026-10-20T12:00:00.000Z').getTime()

describe('isMailSyncStale', () => {
  it('treats a service that never synced as stale', () => {
    expect(isMailSyncStale(undefined, now)).toBe(true)
    expect(isMailSyncStale(null, now)).toBe(true)
  })

  it('keeps a service fresh inside the stale window', () => {
    expect(isMailSyncStale(new Date(now - MAIL_SYNC_STALE_MS), now)).toBe(false)
    expect(isMailSyncStale(new Date(now - 1_000), now)).toBe(false)
  })

  it('refetches once the window has passed', () => {
    expect(isMailSyncStale(new Date(now - MAIL_SYNC_STALE_MS - 1), now)).toBe(true)
  })
})
