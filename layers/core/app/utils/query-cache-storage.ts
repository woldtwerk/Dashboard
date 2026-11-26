import * as idbKeyval from 'idb-keyval'
import { createStorage } from 'unstorage'
import indexedbDriver from 'unstorage/drivers/indexedb'
import { PiniaColadaCachePersister } from '@pinia/colada-plugin-cache-persister'
import type { PersistedQueryCache } from '@pinia/colada-plugin-cache-persister'
import type { PiniaColadaPlugin, QueryCache } from '@pinia/colada'
import {
  QUERY_CACHE_KEY,
  QUERY_CACHE_VERSION,
  isPersistedQueryFresh,
  mergeRestoredQueryCache,
  persistedQueryCacheKey,
  shouldPersistQuery
} from './query-cache-persistence'

const DB_NAME = 'allmight'
const STORE_NAME = 'query-cache'
/** Coalesces the writes a burst of query updates causes. */
const PERSIST_DEBOUNCE_MS = 1000

let storage: ReturnType<typeof createStorage> | undefined

function queryCacheStorage() {
  storage ??= createStorage({
    driver: indexedbDriver({
      dbName: DB_NAME,
      storeName: STORE_NAME,
      // Pass the module instead of letting the driver import it dynamically:
      // a bare runtime import cannot be resolved by Vite in the browser.
      lib: idbKeyval
    })
  })
  return storage
}

/** A version bump drops caches written by another version. */
async function dropSupersededCaches(): Promise<void> {
  const currentPrefix = `${QUERY_CACHE_KEY}:v${QUERY_CACHE_VERSION}:`
  try {
    const keys = await queryCacheStorage().getKeys()
    await Promise.all(keys
      .filter(key => key.startsWith(`${QUERY_CACHE_KEY}:`) && !key.startsWith(currentPrefix))
      .map(key => queryCacheStorage().removeItem(key)))
  } catch {
    // Best effort; this version never reads those keys anyway
  }
}

function createPersisterStorage(getUserId: () => string | undefined) {
  return {
    async getItem(): Promise<string | null> {
      const userId = getUserId()
      if (!userId) {
        return null
      }
      void dropSupersededCaches()
      try {
        const raw = await queryCacheStorage().getItemRaw(persistedQueryCacheKey(userId))
        return typeof raw === 'string' ? raw : null
      } catch {
        return null
      }
    },
    async setItem(_key: string, value: string): Promise<void> {
      const userId = getUserId()
      if (!userId) {
        return
      }
      try {
        await queryCacheStorage().setItemRaw(persistedQueryCacheKey(userId), value)
      } catch {
        // Quota or unavailable storage: persistence is best effort
      }
    }
  }
}

/**
 * Installs the cache persister as a Pinia Colada plugin. Only call it on the
 * client: IndexedDB does not exist during SSR.
 */
export function createPersistedQueryCachePlugin(getUserId: () => string | undefined): PiniaColadaPlugin {
  return (context) => {
    PiniaColadaCachePersister({
      key: QUERY_CACHE_KEY,
      debounce: PERSIST_DEBOUNCE_MS,
      storage: createPersisterStorage(getUserId),
      filter: {
        predicate: entry =>
          shouldPersistQuery(entry.key, entry.state.value.status)
          && isPersistedQueryFresh(entry.key, entry.when)
      },
      // Runs after the async IndexedDB read, by which time the SSR payload has
      // been hydrated synchronously, so a hydrated entry can win here.
      parse: stored => mergeRestoredQueryCache(
        JSON.parse(stored) as PersistedQueryCache,
        (keyHash) => {
          const entry = context.queryCache.caches.get(keyHash)
          if (!entry) {
            return undefined
          }
          // A request in flight must not be replaced by an older snapshot.
          if (entry.pending) {
            return Number.POSITIVE_INFINITY
          }
          return entry.when > 0 ? entry.when : undefined
        }
      )
    })(context)
  }
}

/**
 * Clears what the signed-out user's pages left on the device. Both a normal
 * sign-out and an expired session call this before leaving the app.
 */
export async function clearQueryCacheForSignOut(
  queryCache: QueryCache,
  userId: string | null | undefined
): Promise<void> {
  queryCache.caches.clear()
  if (!userId) {
    return
  }
  try {
    await queryCacheStorage().removeItem(persistedQueryCacheKey(userId))
  } catch {
    // Storage unavailable: the in-memory cache is still gone
  }
}
