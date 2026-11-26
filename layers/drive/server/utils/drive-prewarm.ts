import type { DriveEntry } from '../../shared/types/drive'
import { driveImageId } from '../../shared/drive-image'
import { sortEntries } from '../../shared/drive-sort'
import { entryVersion, thumbnailAllowed } from '../../shared/drive-thumbnails'
import { sharedStorage } from '../../../core/server/utils/shared-storage'
import { cachedOriginal, hasCachedOriginal, originalCacheKey } from '../../../image/server/utils/original-cache'
import { getImageSource } from '../../../image/server/utils/image-sources'
import { isDriveBusy } from './drive-busy'

/**
 * Warms the original-image disk cache for the images of a listing, one at a
 * time. The queue lives in shared storage so every worker sees the same items,
 * and the drain holds a shared lease so only one worker reads from the provider.
 */

/** Images per folder. */
export const DRIVE_PREWARM_LIMIT = 60

/** Per-folder enqueue budget. */
export const DRIVE_PREWARM_MAX_BYTES = 512 * 1024 * 1024

/** Pending items, cluster-wide. */
export const DRIVE_PREWARM_QUEUE_LIMIT = 500

export const DRIVE_PREWARM_QUEUE_PREFIX = 'drive:prewarm:item:'
export const DRIVE_PREWARM_FOLDER_PREFIX = 'drive:prewarm:folder:'
export const DRIVE_PREWARM_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const DRIVE_PREWARM_FOLDER_TTL_MS = 5 * 60_000
export const DRIVE_PREWARM_PAUSE_MS = 1000
export const DRIVE_PREWARM_BUDGET_MS = 60_000
export const DRIVE_PREWARM_LOCK_TTL_MS = 120_000
export const DRIVE_PREWARM_INTERACTIVE_WAIT_MS = 15_000
export const DRIVE_INTERACTIVE_KEY = 'drive:interactive'
export const DRIVE_INTERACTIVE_WINDOW_MS = 10_000

export interface DrivePrewarmItem {
  service: string
  id: string
  version: string
  size: number
  enqueuedAt: number
}

/** The queue key: sha256 only, never a file name. The service only lives in the id. */
export function drivePrewarmKey(item: Pick<DrivePrewarmItem, 'service' | 'id' | 'version'>): string {
  return DRIVE_PREWARM_QUEUE_PREFIX + originalCacheKey('drive', item.id, item.version)
}

/** Images of a listing worth warming, in default sort order, capped by count and bytes. */
export function drivePrewarmItems(
  service: string,
  entries: DriveEntry[],
  options: { limit?: number, maxBytes?: number, now?: number } = {}
): DrivePrewarmItem[] {
  const limit = options.limit ?? DRIVE_PREWARM_LIMIT
  const maxBytes = options.maxBytes ?? DRIVE_PREWARM_MAX_BYTES
  const now = options.now ?? Date.now()

  const items: DrivePrewarmItem[] = []
  const seen = new Set<string>()
  let bytes = 0

  for (const entry of sortEntries(entries, 'name', 'asc')) {
    if (items.length >= limit || bytes >= maxBytes) {
      break
    }
    if (!thumbnailAllowed(entry)) {
      continue
    }

    const item: DrivePrewarmItem = {
      service,
      id: driveImageId(service, entry.path),
      version: entryVersion(entry),
      size: entry.size ?? 0,
      enqueuedAt: now
    }
    const key = drivePrewarmKey(item)
    if (seen.has(key)) {
      continue
    }
    if (bytes + item.size > maxBytes) {
      break
    }

    seen.add(key)
    items.push(item)
    bytes += item.size
  }

  return items
}

/** Items still worth fetching: not already queued and not stale. */
export function pendingPrewarmItems(
  items: DrivePrewarmItem[],
  knownKeys: ReadonlySet<string>,
  now: number = Date.now()
): DrivePrewarmItem[] {
  return items.filter(item =>
    !knownKeys.has(drivePrewarmKey(item))
    && now - item.enqueuedAt < DRIVE_PREWARM_MAX_AGE_MS)
}

/** Best effort: records that a user-facing request is using the provider right now. */
export async function touchDriveInteractive(): Promise<void> {
  try {
    await sharedStorage().setItem(DRIVE_INTERACTIVE_KEY, { at: Date.now() }, {
      ttl: Math.ceil(DRIVE_INTERACTIVE_WINDOW_MS / 1000)
    })
  } catch {
    // A missing marker only means the drain does not know about this request
  }
}

/** True while a user-facing request touched the provider within the window. */
export async function isDriveInteractive(now: number = Date.now()): Promise<boolean> {
  try {
    const marker = await sharedStorage().getItem<{ at: number }>(DRIVE_INTERACTIVE_KEY)
    return !!marker && typeof marker.at === 'number' && now - marker.at < DRIVE_INTERACTIVE_WINDOW_MS
  } catch {
    // A failing storage check must not block prewarming
    return false
  }
}

async function removeQueued(key: string): Promise<void> {
  try {
    await sharedStorage().removeItem(key)
  } catch {
    // The worker-local set keeps a failed removal from picking the item again
  }
}

/** Queues the images of one listing for later warming; never fails the listing. */
export async function enqueueDrivePrewarm(service: string, path: string, entries: DriveEntry[]): Promise<void> {
  try {
    const storage = sharedStorage()
    const folderKey = DRIVE_PREWARM_FOLDER_PREFIX + originalCacheKey(service, path, '')
    const folder = await storage.getItem<{ at: number }>(folderKey)
    if (folder && typeof folder.at === 'number' && Date.now() - folder.at < DRIVE_PREWARM_FOLDER_TTL_MS) {
      return
    }

    const keys = await storage.getKeys(DRIVE_PREWARM_QUEUE_PREFIX)
    if (keys.length >= DRIVE_PREWARM_QUEUE_LIMIT) {
      return
    }

    const items = pendingPrewarmItems(drivePrewarmItems(service, entries), new Set(keys))
    let queued = 0
    for (const item of items) {
      if (await hasCachedOriginal('drive', item.id, item.version)) {
        continue
      }
      await storage.setItem(drivePrewarmKey(item), item, { ttl: Math.ceil(DRIVE_PREWARM_MAX_AGE_MS / 1000) })
      queued++
    }

    await storage.setItem(folderKey, { at: Date.now() }, { ttl: Math.ceil(DRIVE_PREWARM_FOLDER_TTL_MS / 1000) })
    if (queued) {
      void drainDrivePrewarmQueue().catch(() => {})
    }
  } catch (error) {
    useServiceLogger('drive').debug('Could not queue drive originals for prewarming', { error: String(error) })
  }
}

/** Waits out a burst of user-facing requests, giving up after the wait window. */
async function waitForQuiet(): Promise<boolean> {
  const deadline = Date.now() + DRIVE_PREWARM_INTERACTIVE_WAIT_MS
  do {
    await new Promise(resolve => setTimeout(resolve, DRIVE_PREWARM_PAUSE_MS))
    if (!await isDriveInteractive()) {
      return true
    }
  } while (Date.now() < deadline)
  return false
}

/**
 * Warms one queued original at a time, pausing between items. Keeps everything
 * queued when the provider is busy or a user is looking at the drive.
 * @returns the number of items processed by this worker
 */
export async function drainDrivePrewarmQueue(): Promise<number> {
  const processed = await withLock('drive-prewarm', DRIVE_PREWARM_LOCK_TTL_MS, async ({ renew }) => {
    const deadline = Date.now() + DRIVE_PREWARM_BUDGET_MS
    const picked = new Set<string>()
    let count = 0

    for (;;) {
      if (Date.now() >= deadline) {
        break
      }
      if (await isDriveInteractive() && !await waitForQuiet()) {
        break
      }

      const keys = await sharedStorage().getKeys(DRIVE_PREWARM_QUEUE_PREFIX)
      const key = keys.find(candidate => !picked.has(candidate))
      if (!key) {
        break
      }
      picked.add(key)

      const item = await sharedStorage().getItem<DrivePrewarmItem>(key)
      if (!item) {
        await removeQueued(key)
        continue
      }
      if (Date.now() - item.enqueuedAt >= DRIVE_PREWARM_MAX_AGE_MS) {
        await removeQueued(key)
        continue
      }

      const source = getImageSource('drive')
      if (!source) {
        break
      }

      try {
        const { result } = await cachedOriginal('drive', item.id, item.version, () => source.load(item.id))
        const body = result.body as ReadableStream<Uint8Array>
        if (body?.cancel) {
          await body.cancel().catch(() => {})
        }
        await removeQueued(key)
        count++
      } catch (error) {
        if (isDriveBusy(error)) {
          break
        }
        await removeQueued(key)
        useServiceLogger('drive').debug('Could not prewarm a drive original', { error: String(error) })
      }

      if (!await renew()) {
        break
      }
      await new Promise(resolve => setTimeout(resolve, DRIVE_PREWARM_PAUSE_MS))
    }

    return count
  })

  return processed ?? 0
}
