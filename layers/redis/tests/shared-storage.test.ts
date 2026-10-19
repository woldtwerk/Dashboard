import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REDIS_MOUNTPOINT, hasRedisMount, sharedStorage } from '../../core/server/utils/shared-storage'

describe('hasRedisMount', () => {
  it('reports no redis mount on a storage with only the default driver', () => {
    const storage = createStorage({ driver: memoryDriver() })
    expect(hasRedisMount(storage.getMounts())).toBe(false)
  })

  it('recognises the normalized mountpoint of a real `mount("redis", ...)`', () => {
    const storage = createStorage({ driver: memoryDriver() })
    storage.mount('redis', memoryDriver())

    const mounts = storage.getMounts()
    // Locks in the shape the old `mount.base === 'redis'` missed: `redis:`, not `redis`
    expect(mounts.map(mount => mount.base)).toContain(REDIS_MOUNTPOINT)
    expect(hasRedisMount(mounts)).toBe(true)
  })

  it('accepts a mountpoint field too, should a version report it that way', () => {
    expect(hasRedisMount([{ mountpoint: REDIS_MOUNTPOINT }])).toBe(true)
    expect(hasRedisMount([{ mountpoint: 'redis' }])).toBe(true)
    expect(hasRedisMount([{ base: 'memory:' }])).toBe(false)
  })
})

describe('sharedStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the redis storage when the mount is there', () => {
    const storage = createStorage({ driver: memoryDriver() })
    storage.mount('redis', memoryDriver())
    const redis = createStorage({ driver: memoryDriver() })
    const bases: (string | undefined)[] = []

    vi.stubGlobal('useStorage', (base?: string) => {
      bases.push(base)
      return base === 'redis' ? redis : storage
    })

    expect(sharedStorage()).toBe(redis)
    expect(bases).toEqual([undefined, 'redis'])
  })

  it('falls back to the default storage without a redis mount', () => {
    const storage = createStorage({ driver: memoryDriver() })
    vi.stubGlobal('useStorage', () => storage)

    expect(sharedStorage()).toBe(storage)
  })
})
