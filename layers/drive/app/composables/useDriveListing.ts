import type { MaybeRefOrGetter } from 'vue'
import type { DriveEntry } from '#layers/drive/shared/types/drive'
import { driveListingCacheKey, rememberDriveListing, type DriveListingRequests } from '#layers/drive/app/utils/drive-listing-cache'

type NuxtApp = ReturnType<typeof useNuxtApp>
type Fetcher = ReturnType<typeof useRequestFetch>

/**
 * One cache per Nuxt app: the server hands each request its own app, the browser
 * each tab its own, so a cached listing can never reach another visitor.
 */
const caches = new WeakMap<NuxtApp, DriveListingRequests>()

function listingCache(nuxtApp: NuxtApp): DriveListingRequests {
  let cache = caches.get(nuxtApp)
  if (!cache) {
    cache = new Map()
    caches.set(nuxtApp, cache)
  }
  return cache
}

/**
 * A folder listing; an in-flight request is shared, a resolved one is kept
 * (capped, oldest first). `fetcher` is the caller's request-scoped fetch, so a
 * server render forwards the session cookie the same way `useFetch` does.
 */
export function loadDriveListing(
  nuxtApp: NuxtApp,
  fetcher: Fetcher,
  service: string,
  path: string
): Promise<DriveEntry[]> {
  const cache = listingCache(nuxtApp)
  const key = driveListingCacheKey(service, path)
  const cached = cache.get(key)
  if (cached) {
    return cached
  }

  const request = fetcher<DriveEntry[]>('/api/drive/contents', { query: { service, path } })
  rememberDriveListing(cache, key, request)
  // A failure leaves nothing to share; a newer request for the same key stays
  request.catch(() => {
    if (cache.get(key) === request) {
      cache.delete(key)
    }
  })
  return request
}

/**
 * Warm a folder the explorer is about to open; the page reuses the very same
 * request. Resolves once the request settles, so a prefetch queue can serialize
 * its loads.
 */
export function prefetchDriveListing(
  nuxtApp: NuxtApp,
  fetcher: Fetcher,
  service: string,
  path: string
): Promise<void> {
  return loadDriveListing(nuxtApp, fetcher, service, path).then(() => {}, () => {})
}

/**
 * The open folder's entries. The key is stable per folder, so the page, a hover
 * prefetch and a remount all share one request. A listing already in the payload
 * is shown at once (and revalidated by the caller); a manual refresh drops the
 * cached copy first, so the refresh button really asks again.
 */
export function useDriveListing(
  service: MaybeRefOrGetter<string>,
  path: MaybeRefOrGetter<string>
) {
  const nuxtApp = useNuxtApp()
  const requestFetch = useRequestFetch()

  const asyncData = useAsyncData<DriveEntry[]>(
    () => `drive:${toValue(service)}:${toValue(path)}`,
    () => loadDriveListing(nuxtApp, requestFetch, toValue(service), toValue(path)),
    {
      default: () => [],
      getCachedData(key, app, ctx) {
        if (ctx.cause === 'refresh:manual') {
          return undefined
        }
        return app.payload.data[key] ?? app.static.data[key]
      }
    }
  )

  const reload = asyncData.refresh
  asyncData.refresh = (...args) => {
    listingCache(nuxtApp).delete(driveListingCacheKey(toValue(service), toValue(path)))
    return reload(...args)
  }

  return asyncData
}
