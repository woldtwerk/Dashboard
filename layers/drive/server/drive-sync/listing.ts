import type { DriveEntry } from '../../shared/types/drive'
import {
  DRIVE_MY_FILES_ROOT,
  DRIVE_SHARED_ROOT,
  DRIVE_TRASH_ROOT,
  isWithinPath
} from '../../shared/drive-path'

/** The section roots the crawl starts from; every other folder is reached from them. */
export const CRAWL_SEEDS = [DRIVE_MY_FILES_ROOT, DRIVE_SHARED_ROOT, DRIVE_TRASH_ROOT] as const

/**
 * The prefix every descendant of `path` shares. Descendants are matched with
 * `substr(path, 1, length(prefix)) = prefix`, not `LIKE`, so a `%` or `_` in a
 * folder name needs no escaping.
 */
export function descendantPrefix(path: string): string {
  return `${path}/`
}

/**
 * Whether the crawl walks into a folder. The trash root is listed, so its
 * entries are cached, but walking it would spend the budget on deleted files
 * the explorer rarely opens.
 */
export function shouldDescend(folderPath: string): boolean {
  return !isWithinPath(DRIVE_TRASH_ROOT, folderPath)
}

/** Whether a stored entry still has the same data as the listed one. */
function unchanged(stored: DriveEntry, remote: DriveEntry): boolean {
  return stored.name === remote.name
    && stored.type === remote.type
    && stored.size === remote.size
    && stored.modified === remote.modified
    && stored.mediaType === remote.mediaType
    && stored.webUrl === remote.webUrl
}

export interface ListingDiff {
  /** New entries and entries whose data changed */
  upsert: DriveEntry[]
  /** Paths the folder held before but no longer lists */
  removed: string[]
}

/** Compares the stored children of a folder with what it lists now. */
export function diffListing(stored: DriveEntry[], remote: DriveEntry[]): ListingDiff {
  const storedByPath = new Map(stored.map(entry => [entry.path, entry]))
  const remotePaths = new Set(remote.map(entry => entry.path))

  return {
    upsert: remote.filter((entry) => {
      const previous = storedByPath.get(entry.path)
      return !previous || !unchanged(previous, entry)
    }),
    removed: stored.filter(entry => !remotePaths.has(entry.path)).map(entry => entry.path)
  }
}
