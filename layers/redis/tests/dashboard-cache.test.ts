import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateDashboardDomain } from '../../core/server/utils/dashboard'

let storage: ReturnType<typeof createStorage>

beforeEach(() => {
  storage = createStorage({ driver: memoryDriver() })
  vi.stubGlobal('useStorage', () => storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('invalidateDashboardDomain', () => {
  it('removes the cached metrics and every cached series of the domain', async () => {
    await storage.setItem('dashboard:metrics:mail', [{ id: 'mail-unread', value: 3 }])
    await storage.setItem('dashboard:series:mail:mail-received:7', [{ date: '2026-10-18', value: 1 }])
    await storage.setItem('dashboard:series:mail:mail-received:30', [{ date: '2026-10-18', value: 2 }])
    await storage.setItem('dashboard:series:calendar:events-week:30', [])
    await storage.setItem('unrelated:key', true)

    await invalidateDashboardDomain('mail')

    expect(await storage.getKeys()).toEqual([
      'dashboard:series:calendar:events-week:30',
      'unrelated:key'
    ])
  })

  it('does nothing when the domain has no cache', async () => {
    await storage.setItem('dashboard:metrics:calendar', [])

    await expect(invalidateDashboardDomain('mail')).resolves.toBeUndefined()
    expect(await storage.getKeys()).toEqual(['dashboard:metrics:calendar'])
  })
})
