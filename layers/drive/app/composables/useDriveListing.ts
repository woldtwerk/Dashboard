import type { MaybeRefOrGetter } from 'vue'
import type { QueryCache } from '@pinia/colada'
import type { DriveEntry } from '#layers/drive/shared/types/drive'

type Fetcher = ReturnType<typeof useRequestFetch>

/** A folder listing across accounts; paths repeat, so the service is part of the key. */
export function driveListingQueryKey(service: string, path: string) {
  return ['drive', service, path] as const
}

/** The one query the page and a prefetch share, so both hit the same cache entry and request. */
export function driveListingQueryOptions(fetcher: Fetcher, service: string, path: string) {
  return {
    key: driveListingQueryKey(service, path),
    query: () => fetcher<DriveEntry[]>('/api/drive/contents', { query: { service, path } })
  }
}

/** Whether the cache already holds a fresh listing for this folder. */
export function hasFreshDriveListing(queryCache: QueryCache, service: string, path: string): boolean {
  const entry = queryCache.get(driveListingQueryKey(service, path))
  return !!entry && !entry.stale
}

/**
 * Warm a folder the explorer is about to open. `refresh` is a no-op while the
 * entry is fresh and joins an in-flight request otherwise; it resolves once the
 * request settles, so a prefetch queue can serialize its loads.
 */
export function prefetchDriveListing(
  queryCache: QueryCache,
  fetcher: Fetcher,
  service: string,
  path: string
): Promise<void> {
  return queryCache
    .refresh(queryCache.ensure(driveListingQueryOptions(fetcher, service, path)))
    .then(() => {}, () => {})
}

/**
 * The open folder's listing, cached by Pinia Colada: a visited folder shows at
 * once and revalidates when stale. `refetch` ignores staleness, for the refresh
 * button and after a mutation; the returned `data` is the getter only, writes
 * go through `queryCache.setQueryData`.
 */
export function useDriveListing(
  service: MaybeRefOrGetter<string>,
  path: MaybeRefOrGetter<string>
) {
  const fetcher = useRequestFetch()
  // $fetch errors carry `statusMessage`, which the page's error alert shows
  const query = useQuery<DriveEntry[], Error & { statusMessage?: string }>({
    key: () => driveListingQueryKey(toValue(service), toValue(path)),
    query: () => fetcher<DriveEntry[]>('/api/drive/contents', {
      query: { service: toValue(service), path: toValue(path) }
    }),
    ssrCatchError: true
  })

  // The template and the optimistic updates expect a list, even before the first load
  const data = computed(() => query.data.value ?? [])

  return { ...query, data }
}
