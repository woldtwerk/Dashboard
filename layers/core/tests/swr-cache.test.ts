import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SwrCacheOptions } from '../server/utils/swr-cache'
import { cachedSwr, invalidateSwr } from '../server/utils/swr-cache'

interface Stored {
  values: Map<string, unknown>
  ttls: Map<string, number | undefined>
}

let stored: Stored
let nowMs: number
let held: Set<string>

const options = (overrides: Partial<SwrCacheOptions> = {}): SwrCacheOptions => ({
  freshMs: 1_000,
  storeTtlSeconds: 60,
  lockTtlMs: 5_000,
  now: () => nowMs,
  ...overrides
})

function storage() {
  return {
    getMounts: () => [],
    getItem: async (key: string) => stored.values.get(key) ?? null,
    setItem: async (key: string, value: unknown, opts?: { ttl?: number }) => {
      stored.values.set(key, value)
      stored.ttls.set(key, opts?.ttl)
    },
    removeItem: async (key: string) => { stored.values.delete(key) },
    getKeys: async () => [...stored.values.keys()]
  }
}

beforeEach(() => {
  stored = { values: new Map(), ttls: new Map() }
  nowMs = 10_000

  vi.stubGlobal('useStorage', () => storage())

  // Emulates the database lease: a second concurrent holder is turned away
  held = new Set<string>()
  vi.stubGlobal('withLock', (name: string, _ttl: number, fn: (handle: { renew: () => Promise<boolean> }) => Promise<unknown>) => {
    if (held.has(name)) {
      return Promise.resolve(undefined)
    }
    held.add(name)
    return Promise.resolve(fn({ renew: async () => true })).finally(() => held.delete(name))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function flush(times = 10) {
  for (let index = 0; index < times; index++) {
    await Promise.resolve()
  }
}

describe('cachedSwr', () => {
  it('serves a fresh entry without loading', async () => {
    stored.values.set('key', { value: 'fresh', at: nowMs })
    const load = vi.fn(async () => 'loaded')

    await expect(cachedSwr('key', load, options())).resolves.toBe('fresh')
    expect(load).not.toHaveBeenCalled()
  })

  it('serves a stale entry at once and refreshes once for concurrent reads', async () => {
    stored.values.set('key', { value: 'old', at: nowMs - 2_000 })
    const load = vi.fn(async () => 'new')

    const [first, second] = await Promise.all([
      cachedSwr('key', load, options()),
      cachedSwr('key', load, options())
    ])
    expect(first).toBe('old')
    expect(second).toBe('old')

    await flush()

    expect(load).toHaveBeenCalledTimes(1)
    expect(stored.values.get('key')).toEqual({ value: 'new', at: nowMs })
    expect(stored.ttls.get('key')).toBe(60)
  })

  it('loads a missing entry inline and stores it with the configured ttl', async () => {
    const load = vi.fn(async () => 'loaded')

    await expect(cachedSwr('key', load, options())).resolves.toBe('loaded')
    expect(load).toHaveBeenCalledTimes(1)
    expect(stored.values.get('key')).toEqual({ value: 'loaded', at: nowMs })
    expect(stored.ttls.get('key')).toBe(60)
  })

  it('loads inline and stores best effort when the storage read fails', async () => {
    vi.stubGlobal('useStorage', () => ({
      getMounts: () => [],
      getItem: async () => { throw new Error('storage down') },
      setItem: async () => { throw new Error('storage down') }
    }))
    const load = vi.fn(async () => 'loaded')

    await expect(cachedSwr('key', load, options())).resolves.toBe('loaded')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps the stale value and reports a failed background refresh once', async () => {
    stored.values.set('key', { value: 'old', at: nowMs - 2_000 })
    const error = new Error('down')
    const load = vi.fn(async () => {
      throw error
    })
    const onRefreshError = vi.fn()

    await expect(cachedSwr('key', load, options({ onRefreshError }))).resolves.toBe('old')

    await flush()

    expect(onRefreshError).toHaveBeenCalledTimes(1)
    expect(onRefreshError).toHaveBeenCalledWith(error, 'key')
    expect(stored.values.get('key')).toEqual({ value: 'old', at: nowMs - 2_000 })
  })

  it('does not overwrite an invalidation that arrives during an in-flight refresh', async () => {
    stored.values.set('key', { value: 'old', at: nowMs - 2_000 })
    let resolveLoad!: (value: string) => void
    const load = vi.fn(() => new Promise<string>((resolve) => {
      resolveLoad = resolve
    }))

    await expect(cachedSwr('key', load, options())).resolves.toBe('old')
    await flush()
    expect(load).toHaveBeenCalledTimes(1)

    await invalidateSwr('key', 60)
    expect(stored.values.get('key')).toEqual({ value: 'old', at: 0 })

    resolveLoad('new')
    await flush()

    expect(stored.values.get('key')).toEqual({ value: 'old', at: 0 })
    expect(stored.ttls.get('key')).toBe(60)
  })

  describe('force', () => {
    it('reloads a fresh entry and stores the result', async () => {
      stored.values.set('key', { value: 'old', at: nowMs })
      const load = vi.fn(async () => 'new')

      await expect(cachedSwr('key', load, options({ force: true }))).resolves.toBe('new')
      expect(load).toHaveBeenCalledTimes(1)
      expect(stored.values.get('key')).toEqual({ value: 'new', at: nowMs })
    })

    it('keeps the existing value when the load fails', async () => {
      stored.values.set('key', { value: 'old', at: nowMs })
      const load = vi.fn(async () => {
        throw new Error('down')
      })

      await expect(cachedSwr('key', load, options({ force: true }))).resolves.toBe('old')
      expect(stored.values.get('key')).toEqual({ value: 'old', at: nowMs })
    })

    it('rejects when there is no entry to fall back to', async () => {
      const load = vi.fn(async () => {
        throw new Error('down')
      })

      await expect(cachedSwr('key', load, options({ force: true }))).rejects.toThrow('down')
    })
  })
})

describe('invalidateSwr', () => {
  it('marks the entry stale, keeps its value and revalidates on the next read', async () => {
    stored.values.set('key', { value: 'old', at: nowMs })

    await invalidateSwr('key', 60)
    expect(stored.values.get('key')).toEqual({ value: 'old', at: 0 })
    expect(stored.ttls.get('key')).toBe(60)

    const load = vi.fn(async () => 'new')
    await expect(cachedSwr('key', load, options())).resolves.toBe('old')

    await flush()

    expect(load).toHaveBeenCalledTimes(1)
    expect(stored.values.get('key')).toEqual({ value: 'new', at: nowMs })
  })
})
