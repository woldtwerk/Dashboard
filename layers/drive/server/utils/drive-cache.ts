import type { DriveEntry } from '../../shared/types/drive'
import { DRIVE_SHARED_ROOT, DRIVE_TRASH_ROOT, parentPath } from '../../shared/drive-path'

/**
 * Folder listings are cached in the shared Nitro storage (Redis when mounted,
 * so every cluster worker and every instance sees the same bytes). A listing is
 * served for `DRIVE_LIST_TTL_MS` without touching the provider; after that it is
 * still served at once, while one worker refreshes it in the background. The
 * provider serializes every CLI call under one lock, so the cache is what keeps
 * navigation from queueing behind a 15 s `list`.
 */

/** How long a listing is considered fresh. */
export const DRIVE_LIST_TTL_MS = 30_000

/** Lease for a background refresh; a slow CLI call must not lose it mid-flight. */
export const DRIVE_LIST_LOCK_TTL_MS = 60_000

export interface CachedListing {
  entries: DriveEntry[]
  /** `Date.now()` when the listing was read from the provider */
  fetchedAt: number
}

export function driveListKey(service: string, path: string): string {
  return `drive:list:${service}:${path}`
}

/** The lease one worker holds while it refreshes a listing from the provider. */
export function driveListLock(service: string, path: string): string {
  return `drive-list:${service}:${path}`
}

/** Redis when mounted (shared by every cluster worker), else the default Nitro storage. */
export function driveStorage() {
  const storage = useStorage()
  return storage.getMounts().some(mount => mount.base === 'redis') ? useStorage('redis') : storage
}

async function readListing(key: string): Promise<CachedListing | undefined> {
  try {
    return await driveStorage().getItem<CachedListing>(key) ?? undefined
  } catch {
    // A listing still works without its cache
    return undefined
  }
}

async function writeListing(key: string, listing: CachedListing): Promise<void> {
  try {
    await driveStorage().setItem(key, listing)
  } catch {
    // Best effort: a cache write never fails a request
  }
}

function entrySignature(entry: DriveEntry): string {
  return `${entry.name}\u0000${entry.size ?? ''}\u0000${entry.modified ?? ''}`
}

/** Whether two listings hold the same entries, by path, name, size and modified time. */
export function sameEntries(a: DriveEntry[], b: DriveEntry[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  const signatures = new Map(a.map(entry => [entry.path, entrySignature(entry)]))
  return b.every(entry => signatures.get(entry.path) === entrySignature(entry))
}

/** Whether a provider failure means the CLI is busy rather than genuinely broken. */
export function isDriveBusy(error: unknown): boolean {
  const status = (error as { status?: number, statusCode?: number } | undefined)?.status
    ?? (error as { statusCode?: number } | undefined)?.statusCode
  if (status === 423 || status === 429) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /\bbusy\b/i.test(message)
}

async function loadListing(
  service: string,
  path: string,
  key: string,
  previous: CachedListing | undefined,
  load: () => Promise<DriveEntry[]>
): Promise<DriveEntry[]> {
  const entries = await load()
  await writeListing(key, { entries, fetchedAt: Date.now() })

  // Only a listing that actually changed is worth an event, so the first load stays quiet
  if (previous && !sameEntries(previous.entries, entries)) {
    await publishDomainEvent({ domain: 'drive', service, type: 'changed', resource: path })
  }

  return entries
}

async function revalidate(
  service: string,
  path: string,
  key: string,
  previous: CachedListing,
  load: () => Promise<DriveEntry[]>
): Promise<void> {
  try {
    await withLock(driveListLock(service, path), DRIVE_LIST_LOCK_TTL_MS, async () => {
      // Another worker may have refreshed while this one waited for the lease
      const current = await readListing(key)
      if (current && Date.now() - current.fetchedAt < DRIVE_LIST_TTL_MS) {
        return
      }
      await loadListing(service, path, key, current ?? previous, load)
    })
  } catch (error) {
    // A busy or failing refresh keeps the stale listing; only a real failure is worth a log
    if (!isDriveBusy(error)) {
      console.warn(`[drive] Could not refresh the listing of "${path}":`, error)
    }
  }
}

/**
 * The entries of a folder, from the shared cache when possible. A missing
 * listing is loaded; a fresh one is returned as is; a stale one is returned at
 * once and refreshed behind the lock. When the provider is busy, a cached
 * listing is always preferred over an error.
 */
export async function cachedList(service: string, path: string, load: () => Promise<DriveEntry[]>): Promise<DriveEntry[]> {
  const key = driveListKey(service, path)
  const cached = await readListing(key)

  if (cached) {
    if (Date.now() - cached.fetchedAt < DRIVE_LIST_TTL_MS) {
      return cached.entries
    }
    void revalidate(service, path, key, cached, load)
    return cached.entries
  }

  try {
    return await loadListing(service, path, key, undefined, load)
  } catch (error) {
    const fallback = isDriveBusy(error) ? await readListing(key) : undefined
    if (fallback) {
      return fallback.entries
    }
    throw error
  }
}

/** A mutation that changes one or more folder listings. */
export type DriveMutationAction = 'folder' | 'rename' | 'move' | 'copy' | 'trash'
  | 'restore' | 'delete' | 'empty-trash' | 'upload' | 'invitation-accept'

export interface DriveMutationInput {
  /** The parent folder of a create or an upload; the entry a rename changes */
  path?: string
  /** The entries a multi-entry mutation works on */
  paths?: string[]
  /** The destination folder of a move or a copy */
  target?: string
  /** Whether an invitation was accepted rather than rejected */
  accept?: boolean
}

/**
 * Every folder listing a mutation changes: the parents of the affected entries
 * and, where relevant, the destination folder. These are exactly the resources
 * the change events name, and the listings whose cache is dropped.
 */
export function affectedPaths(action: DriveMutationAction, input: DriveMutationInput): string[] {
  let paths: string[]

  switch (action) {
    case 'folder':
    case 'upload':
      paths = input.path ? [input.path] : []
      break
    case 'rename':
      paths = input.path ? [parentPath(input.path)] : []
      break
    case 'move':
    case 'copy':
      paths = [...(input.paths ?? []).map(parentPath), ...(input.target ? [input.target] : [])]
      break
    case 'trash':
    case 'restore':
      paths = [...(input.paths ?? []).map(parentPath), DRIVE_TRASH_ROOT]
      break
    case 'delete':
      paths = (input.paths ?? []).map(parentPath)
      break
    case 'empty-trash':
      paths = [DRIVE_TRASH_ROOT]
      break
    case 'invitation-accept':
      paths = input.accept ? [DRIVE_SHARED_ROOT] : []
      break
    default:
      paths = []
  }

  return [...new Set(paths)]
}

/** Drops the cached listings of `paths`, so the next read asks the provider. */
export async function invalidateDriveListings(service: string, paths: string[]): Promise<void> {
  const storage = driveStorage()
  await Promise.all([...new Set(paths)].map(async (path) => {
    try {
      await storage.removeItem(driveListKey(service, path))
    } catch (error) {
      console.warn(`[drive] Could not invalidate the cached listing of "${path}":`, error)
    }
  }))
}
