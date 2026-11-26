/**
 * A stale-while-revalidate cache over the shared Nitro storage (Redis when
 * mounted, so every cluster worker reads the same bytes). A fresh entry is
 * returned as is; a stale one is returned at once while one worker refreshes it
 * under a database-backed lease. Values live longer in the store than they are
 * considered fresh, so a restart or an eviction still answers from cache.
 */

import { sharedStorage } from './shared-storage'

export interface SwrCacheOptions {
  freshMs: number
  storeTtlSeconds: number
  lockTtlMs: number
  /** Clock, injectable for tests. Defaults to Date.now. */
  now?: () => number
  /** Reload even when the entry is fresh, inline, and store the result. */
  force?: boolean
  /** Called once per failed background refresh. Defaults to console.warn. */
  onRefreshError?: (error: unknown, key: string) => void
}

interface SwrEntry<T> { value: T, at: number }

async function writeEntry<T>(key: string, value: T, at: number, ttl: number): Promise<void> {
  try {
    await sharedStorage().setItem(key, { value, at }, { ttl })
  } catch {
    // Best effort: a cache write never fails a request
  }
}

async function refresh<T>(
  key: string,
  load: () => Promise<T>,
  options: SwrCacheOptions,
  now: () => number,
  onRefreshError: (error: unknown, key: string) => void
): Promise<void> {
  try {
    await withLock(`swr-lock:${key}`, options.lockTtlMs, async () => {
      // Another worker may have refreshed while this one waited for the lease
      let current: SwrEntry<T> | undefined
      try {
        current = await sharedStorage().getItem<SwrEntry<T>>(key) ?? undefined
      } catch {
        // A store that cannot be read must not stop the refresh
      }

      if (current && now() - current.at < options.freshMs) {
        return
      }

      const baseline = current?.at
      const value = await load()

      let latest: SwrEntry<T> | undefined
      try {
        latest = await sharedStorage().getItem<SwrEntry<T>>(key) ?? undefined
      } catch {
        // An unreadable store cannot confirm the entry is unchanged
        return
      }

      if (latest && latest.at !== baseline) {
        // An invalidation or another writer changed the entry while loading; keep their version
        return
      }

      await writeEntry(key, value, now(), options.storeTtlSeconds)
    })
  } catch (error) {
    onRefreshError(error, key)
  }
}

/** The value of `key`, from the shared cache when possible. */
export async function cachedSwr<T>(key: string, load: () => Promise<T>, options: SwrCacheOptions): Promise<T> {
  const now = options.now ?? Date.now
  const onRefreshError = options.onRefreshError ?? ((error: unknown, entryKey: string) => {
    console.warn(`[swr] Could not refresh "${entryKey}"`, error)
  })

  let entry: SwrEntry<T> | undefined
  try {
    entry = await sharedStorage().getItem<SwrEntry<T>>(key) ?? undefined
  } catch {
    // The endpoint still works without its cache: load inline, store best effort
    const value = await load()
    await writeEntry(key, value, now(), options.storeTtlSeconds)
    return value
  }

  if (!entry) {
    const value = await load()
    await writeEntry(key, value, now(), options.storeTtlSeconds)
    return value
  }

  if (options.force) {
    try {
      const value = await load()
      await writeEntry(key, value, now(), options.storeTtlSeconds)
      return value
    } catch {
      // Keep the last good value; a failed load is never cached
      return entry.value
    }
  }

  if (now() - entry.at < options.freshMs) {
    return entry.value
  }

  void refresh(key, load, options, now, onRefreshError)
  return entry.value
}

/**
 * Marks the entry stale instead of deleting it, so the next read answers from
 * the old value while it revalidates. The store TTL is kept, so an invalidated
 * entry still expires. Best effort: an invalidation never fails the request
 * that triggered it.
 */
export async function invalidateSwr(key: string, ttlSeconds: number): Promise<void> {
  try {
    const entry = await sharedStorage().getItem<{ value: unknown, at: number }>(key)
    if (entry) {
      await sharedStorage().setItem(key, { value: entry.value, at: 0 }, { ttl: ttlSeconds })
    }
  } catch {
    // Best effort: a failed invalidation must not fail a request
  }
}
