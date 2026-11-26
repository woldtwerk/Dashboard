import type { DriveEntry, DriveOrder, DriveSort } from './types/drive'

/** Folders first, then the chosen field; the order flips the field, never the folders. */
export function sortEntries(entries: DriveEntry[], sort: DriveSort, order: DriveOrder): DriveEntry[] {
  const direction = order === 'desc' ? -1 : 1

  return [...entries].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'folder' ? -1 : 1
    }
    return compareEntries(left, right, sort) * direction
  })
}

function compareEntries(left: DriveEntry, right: DriveEntry, sort: DriveSort): number {
  switch (sort) {
    case 'modified':
      return (left.modified ?? '').localeCompare(right.modified ?? '')
    case 'size':
      return (left.size ?? 0) - (right.size ?? 0)
    default:
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  }
}
