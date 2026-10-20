import type { DriveEntry } from '../../shared/types/drive'

/** A listing as `drive-cache` stores it in the shared store. */
export interface StoredListing {
  entries: DriveEntry[]
  /** `Date.now()` when the listing was read from the provider */
  fetchedAt: number
}

/**
 * The listing cache the crawl reads from and writes to. `drive-cache` passes it
 * in instead of the crawl importing the request path's module, so the two stay
 * apart and the crawl can be tested without the shared storage.
 */
export interface DriveListingCache {
  /** How long a stored listing counts as fresh */
  ttlMs: number
  /** A stored listing of a folder, or undefined when it is not cached */
  read: (service: string, path: string) => Promise<StoredListing | undefined>
  /** Stores a listing in the shared cache, announcing a change */
  store: (service: string, path: string, entries: DriveEntry[]) => Promise<void>
  /** Whether a provider failure only means the CLI is busy */
  isBusy: (error: unknown) => boolean
}
