import type { EntryKey } from '@pinia/colada'
import type { PersistedQueryCache } from '@pinia/colada-plugin-cache-persister'

/** Where the cache lives; the version and the user are appended per browser profile. */
export const QUERY_CACHE_KEY = 'query-cache'
export const QUERY_CACHE_VERSION = 1

/** A new version must not read back the previous version's data. */
export function persistedQueryCacheKey(userId: string, version = QUERY_CACHE_VERSION): string {
  return `${QUERY_CACHE_KEY}:v${version}:${userId}`
}

/** Only the domains whose pages must open with their last data are persisted. */
export function shouldPersistQuery(key: EntryKey, status: string): boolean {
  const domain = key[0]
  return status === 'success' && (domain === 'mail' || domain === 'drive')
}

/** Mirrors the gcTime of mail bodies and of the list-like mail/drive queries. */
export const PERSISTED_MESSAGE_MAX_AGE = 30 * 60_000
export const PERSISTED_LIST_MAX_AGE = 24 * 60 * 60_000

function persistedQueryMaxAge(key: readonly unknown[]): number {
  return key[0] === 'mail' && key[2] === 'message'
    ? PERSISTED_MESSAGE_MAX_AGE
    : PERSISTED_LIST_MAX_AGE
}

/** Whether a fetched entry is still within the lifetime it is persisted for. */
export function isPersistedQueryFresh(key: EntryKey, when: number, now = Date.now()): boolean {
  return now - when <= persistedQueryMaxAge(key)
}

/**
 * SSR-hydrated entries are fresher than what the last session saved, so a
 * restored entry only replaces one that is missing, empty or older.
 */
export function mergeRestoredQueryCache(
  stored: PersistedQueryCache,
  existingWhen: (keyHash: string) => number | undefined,
  now = Date.now()
): PersistedQueryCache {
  const merged: PersistedQueryCache = {}
  for (const [keyHash, entry] of Object.entries(stored)) {
    const storedWhen = entry[2] ?? 0
    let key: unknown
    try {
      key = JSON.parse(keyHash)
    } catch {
      continue
    }
    if (!Array.isArray(key) || now - storedWhen > persistedQueryMaxAge(key)) {
      continue
    }
    const inMemory = existingWhen(keyHash)
    if (inMemory !== undefined && inMemory >= storedWhen) {
      continue
    }
    merged[keyHash] = entry
  }
  return merged
}
