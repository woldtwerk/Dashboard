import { describe, expect, it, vi } from 'vitest'
import { syncStaleServices } from '../server/utils/service-sync'
import type { StaleSyncDeps } from '../server/utils/service-sync'

function deps(overrides: Partial<StaleSyncDeps> = {}): StaleSyncDeps {
  return {
    services: async () => [{ id: 'mail-1' }, { id: 'mail-2' }],
    syncIfStale: async () => true,
    logger: () => ({ warn: () => {} }),
    ...overrides
  }
}

describe('syncStaleServices', () => {
  it('syncs every service of the domain', async () => {
    const syncIfStale = vi.fn(async (_service: string) => true)

    await expect(syncStaleServices(deps({ syncIfStale }))).resolves.toEqual({ synced: 2, skipped: 0 })
    expect(syncIfStale.mock.calls.map(([service]) => service)).toEqual(['mail-1', 'mail-2'])
  })

  it('counts a fresh or locked service as skipped', async () => {
    const result = await syncStaleServices(deps({
      syncIfStale: async service => service === 'mail-1'
    }))

    expect(result).toEqual({ synced: 1, skipped: 1 })
  })

  it('keeps syncing the other services after one fails', async () => {
    const warn = vi.fn()
    const syncIfStale = vi.fn(async (service: string) => {
      if (service === 'mail-1') {
        throw new Error('mail server offline')
      }
      return true
    })

    await expect(syncStaleServices(deps({ syncIfStale, logger: () => ({ warn }) })))
      .resolves.toEqual({ synced: 1, skipped: 1 })
    expect(warn).toHaveBeenCalledWith('Background sync failed', { error: 'mail server offline' })
    expect(syncIfStale).toHaveBeenCalledTimes(2)
  })

  it('logs through the logger of the failing service', async () => {
    const warn = vi.fn()

    await syncStaleServices(deps({
      syncIfStale: async (service) => {
        if (service === 'mail-2') {
          throw new Error('authentication failed')
        }
        return true
      },
      logger: service => ({ warn: (message, meta) => warn(service, message, meta) })
    }))

    expect(warn).toHaveBeenCalledWith('mail-2', 'Background sync failed', { error: 'authentication failed' })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('runs the services one after another', async () => {
    let running = 0
    const concurrency: number[] = []

    await syncStaleServices(deps({
      syncIfStale: async () => {
        concurrency.push(++running)
        await new Promise(resolve => setTimeout(resolve, 0))
        running--
        return true
      }
    }))

    expect(concurrency).toEqual([1, 1])
  })
})
