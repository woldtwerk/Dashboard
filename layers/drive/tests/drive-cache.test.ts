import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriveEntry } from '../shared/types/drive'
import {
  DRIVE_LIST_STORE_TTL_SECONDS,
  DRIVE_LIST_TTL_MS,
  affectedPaths,
  cachedList,
  sameEntries,
  waitForListing
} from '../server/utils/drive-cache'

const entry = (path: string, overrides: Partial<DriveEntry> = {}): DriveEntry => ({
  uid: path,
  name: path.split('/').pop() ?? path,
  type: 'file',
  parent: '/my-files',
  path,
  ...overrides
})

const listingKey = (service: string, path: string) => `drive:list:${service}:${path}`

interface Stored {
  values: Map<string, unknown>
}

let stored: Stored
let published: unknown[]
let busy: () => Error
let writtenTtl: number | undefined
let held: Set<string>

function storage() {
  return {
    getMounts: () => [],
    getItem: async (key: string) => stored.values.get(key) ?? null,
    setItem: async (key: string, value: unknown, options?: { ttl?: number }) => {
      stored.values.set(key, value)
      writtenTtl = options?.ttl
    },
    removeItem: async (key: string) => { stored.values.delete(key) },
    getKeys: async () => [...stored.values.keys()]
  }
}

function createBusyError() {
  return Object.assign(new Error('The provider is busy'), { status: 423 })
}

async function throwBusy(): Promise<DriveEntry[]> {
  throw busy()
}

beforeEach(() => {
  stored = { values: new Map() }
  published = []
  writtenTtl = undefined
  busy = createBusyError

  vi.stubGlobal('useStorage', () => storage())
  vi.stubGlobal('useServiceLogger', () => ({ warn: () => {}, error: () => {}, info: () => {} }))
  vi.stubGlobal('publishDomainEvent', (event: unknown) => {
    published.push(event)
    return Promise.resolve()
  })

  // Emulates the database lease: a second concurrent holder is turned away
  held = new Set<string>()
  vi.stubGlobal('isLockHeld', (name: string) => Promise.resolve(held.has(name)))
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

describe('sameEntries', () => {
  it('compares by path, name, size and modified, ignoring order', () => {
    const a = [entry('/a', { size: 1, modified: '2026-10-18T00:00:00Z' }), entry('/b')]
    const b = [entry('/b'), entry('/a', { size: 1, modified: '2026-10-18T00:00:00Z' })]
    expect(sameEntries(a, b)).toBe(true)
  })

  it('detects a changed name, size, modified or entry set', () => {
    const base = [entry('/a', { size: 1 })]
    expect(sameEntries(base, [entry('/a', { size: 2 })])).toBe(false)
    expect(sameEntries(base, [entry('/a', { size: 1, name: 'other' })])).toBe(false)
    expect(sameEntries(base, [entry('/a', { size: 1, modified: '2026-01-01T00:00:00Z' })])).toBe(false)
    expect(sameEntries(base, [])).toBe(false)
    expect(sameEntries(base, [entry('/a', { size: 1 }), entry('/b')])).toBe(false)
  })
})

describe('affectedPaths', () => {
  it('names the listing a create or an upload changes', () => {
    expect(affectedPaths('folder', { path: '/my-files/Docs' })).toEqual(['/my-files/Docs'])
    expect(affectedPaths('upload', { path: '/my-files' })).toEqual(['/my-files'])
  })

  it('names the parent of a renamed entry', () => {
    expect(affectedPaths('rename', { path: '/my-files/Docs/a.txt' })).toEqual(['/my-files/Docs'])
  })

  it('names the source parents and the target of a move or copy', () => {
    expect(affectedPaths('move', { paths: ['/my-files/a', '/my-files/b'], target: '/my-files/Docs' }))
      .toEqual(['/my-files', '/my-files/Docs'])
    expect(affectedPaths('copy', { paths: ['/my-files/a'], target: '/my-files/Docs' }))
      .toEqual(['/my-files', '/my-files/Docs'])
  })

  it('names the source parents and the trash root of a trash or restore', () => {
    expect(affectedPaths('trash', { paths: ['/my-files/a'] })).toEqual(['/my-files', '/trash'])
    expect(affectedPaths('restore', { paths: ['/trash/a'] })).toEqual(['/trash'])
  })

  it('names the parents of deleted entries', () => {
    expect(affectedPaths('delete', { paths: ['/my-files/Docs/a', '/my-files/b'] }))
      .toEqual(['/my-files/Docs', '/my-files'])
  })

  it('names the trash root and the shared root only when accepting', () => {
    expect(affectedPaths('empty-trash', {})).toEqual(['/trash'])
    expect(affectedPaths('invitation-accept', { accept: true })).toEqual(['/shared-with-me'])
    expect(affectedPaths('invitation-accept', { accept: false })).toEqual([])
  })
})

describe('cachedList', () => {
  it('serves a fresh listing without calling the provider', async () => {
    const entries = [entry('/a')]
    stored.values.set(listingKey('svc', '/my-files'), { entries, fetchedAt: Date.now() })

    const load = vi.fn(async () => [entry('/b')])
    await expect(cachedList('svc', '/my-files', load)).resolves.toEqual(entries)
    expect(load).not.toHaveBeenCalled()
  })

  it('serves a stale listing at once and revalidates it once in the background', async () => {
    const stale = [entry('/a')]
    stored.values.set(listingKey('svc', '/my-files'), { entries: stale, fetchedAt: Date.now() - DRIVE_LIST_TTL_MS - 1000 })

    const fresh = [entry('/a'), entry('/b')]
    const load = vi.fn(async () => fresh)

    const [first, second] = await Promise.all([
      cachedList('svc', '/my-files', load),
      cachedList('svc', '/my-files', load)
    ])
    expect(first).toEqual(stale)
    expect(second).toEqual(stale)

    await flush()

    expect(load).toHaveBeenCalledTimes(1)
    const cached = stored.values.get(listingKey('svc', '/my-files')) as { entries: DriveEntry[] }
    expect(cached.entries).toEqual(fresh)
    expect(published).toEqual([{ domain: 'drive', service: 'svc', type: 'changed', resource: '/my-files' }])
  })

  it('keeps the cached listing when the background refresh is busy', async () => {
    const stale = [entry('/a')]
    stored.values.set(listingKey('svc', '/my-files'), { entries: stale, fetchedAt: Date.now() - DRIVE_LIST_TTL_MS - 1000 })

    const load = vi.fn(throwBusy)
    await expect(cachedList('svc', '/my-files', load)).resolves.toEqual(stale)

    await flush()

    const cached = stored.values.get(listingKey('svc', '/my-files')) as { entries: DriveEntry[] }
    expect(cached.entries).toEqual(stale)
    expect(published).toEqual([])
  })

  it('rejects a busy load when nothing is cached', async () => {
    const load = vi.fn(throwBusy)
    await expect(cachedList('svc', '/my-files', load)).rejects.toMatchObject({ status: 423 })
  })

  it('loads a cold folder once and hands the other request the shared listing', async () => {
    const entries = [entry('/a')]
    let resolveLoad!: (value: DriveEntry[]) => void
    const load = vi.fn(() => new Promise<DriveEntry[]>((resolve) => {
      resolveLoad = resolve
    }))

    const first = cachedList('svc', '/my-files', load)
    const second = cachedList('svc', '/my-files', load)

    await flush()
    expect(load).toHaveBeenCalledTimes(1)

    resolveLoad(entries)
    await expect(first).resolves.toEqual(entries)
    await expect(second).resolves.toEqual(entries)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('loads itself as soon as a failed lease is released, not after the wait cap', async () => {
    const entries = [entry('/a')]
    let rejectLoad!: (error: Error) => void
    const failing = new Promise<DriveEntry[]>((_resolve, reject) => {
      rejectLoad = reject
    })
    const load = vi.fn()
      .mockReturnValueOnce(failing)
      .mockResolvedValueOnce(entries)

    const started = Date.now()
    const holder = cachedList('svc', '/my-files', load)
    const waiter = cachedList('svc', '/my-files', load)

    await flush()
    expect(load).toHaveBeenCalledTimes(1)

    rejectLoad(createBusyError())

    await expect(holder).rejects.toMatchObject({ status: 423 })
    await expect(waiter).resolves.toEqual(entries)
    // The lease is gone, so the waiter loads at once instead of polling out the cap
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('stores a listing long enough to survive a restart', async () => {
    await cachedList('svc', '/my-files', async () => [entry('/a')])
    expect(writtenTtl).toBe(DRIVE_LIST_STORE_TTL_SECONDS)
  })
})

describe('waitForListing', () => {
  it('returns the listing as soon as another request writes it', async () => {
    const listing = { entries: [entry('/a')], fetchedAt: Date.now() }
    let reads = 0

    const result = await waitForListing('svc', '/my-files', {
      timeoutMs: 1000,
      intervalMs: 1,
      read: async () => (++reads >= 2 ? listing : undefined),
      held: async () => true
    })

    expect(result).toBe(listing)
    expect(reads).toBe(2)
  })

  it('stops as soon as the holder released the lease without a listing', async () => {
    let polls = 0

    const result = await waitForListing('svc', '/my-files', {
      timeoutMs: 10_000,
      intervalMs: 1,
      read: async () => undefined,
      held: async () => {
        polls++
        return polls < 3
      }
    })

    expect(result).toBeUndefined()
    expect(polls).toBe(3)
  })

  it('gives up once the cap has passed even while the lease is held', async () => {
    const result = await waitForListing('svc', '/my-files', {
      timeoutMs: 5,
      intervalMs: 1,
      read: async () => undefined,
      held: async () => true
    })

    expect(result).toBeUndefined()
  })
})
