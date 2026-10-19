import type { DriveEntry } from '#layers/drive/shared/types/drive'

/** How many folder listings one app keeps; the oldest goes first. */
export const DRIVE_LISTING_CACHE_SIZE = 30

/** In-flight and resolved listing requests, in insertion order (oldest first). */
export type DriveListingRequests = Map<string, Promise<DriveEntry[]>>

/** A folder listing across accounts; paths repeat, so the service is part of it. */
export function driveListingCacheKey(service: string, path: string): string {
  return `${service}\u0000${path}`
}

/**
 * Remember a listing request and drop the oldest ones beyond `limit`, so a long
 * session does not keep every folder it has visited. Re-remembering a key moves
 * it to the newest end. Returns the request, so callers can chain on it.
 */
export function rememberDriveListing(
  cache: DriveListingRequests,
  key: string,
  request: Promise<DriveEntry[]>,
  limit = DRIVE_LISTING_CACHE_SIZE
): Promise<DriveEntry[]> {
  cache.delete(key)
  cache.set(key, request)

  while (cache.size > limit) {
    const oldest = cache.keys().next()
    if (oldest.done) {
      break
    }
    cache.delete(oldest.value)
  }

  return request
}
