import { and, inArray, sql } from 'drizzle-orm'
import type { DriveEntryType } from '../../shared/types/drive'
import { DRIVE_TRASH_ROOT } from '../../shared/drive-path'
import { driveCacheSchema } from '../db/cache'
import { driveEntries } from '../db/cache-schema'
import { descendantPrefix } from '../drive-sync/listing'
import { escapeLike, normalizeSearchText, searchTerms } from '../drive-sync/search'
import type { DriveCacheDb } from './drive-sync'

/** One drive entry the global search found. */
export interface DriveSearchHit {
  service: string
  path: string
  name: string
  parent: string
  type: DriveEntryType
  modified?: string
  size?: number
}

function cacheDb(): Promise<DriveCacheDb> {
  return useCacheDb('drive', driveCacheSchema)
}

/**
 * Searches the cached entry names of the given services. Every term has to
 * match the folded name, so `quarterly report` finds `Quarterly report 2026.pdf`;
 * the trash is left out because the explorer does not show it as files.
 */
export async function searchDriveEntries(
  services: string[],
  query: string,
  limit: number,
  db?: DriveCacheDb
): Promise<DriveSearchHit[]> {
  const terms = searchTerms(query)
  const ids = [...new Set(services)]

  if (!terms.length || !ids.length || limit <= 0) {
    return []
  }

  const whole = normalizeSearchText(query).trim()
  const trashPrefix = descendantPrefix(DRIVE_TRASH_ROOT)
  const cache = db ?? await cacheDb()

  const rows = await cache.select({
    service: driveEntries.service,
    path: driveEntries.path,
    name: driveEntries.name,
    parent: driveEntries.parent,
    type: driveEntries.type,
    modified: driveEntries.modified,
    size: driveEntries.size
  }).from(driveEntries)
    .where(and(
      inArray(driveEntries.service, ids),
      sql`${driveEntries.path} != ${DRIVE_TRASH_ROOT}`,
      sql`substr(${driveEntries.path}, 1, ${trashPrefix.length}) != ${trashPrefix}`,
      // `ESCAPE` makes `%` and `_` in a term literal characters, not wildcards
      ...terms.map(term => sql`${driveEntries.nameSearch} LIKE '%' || ${escapeLike(term)} || '%' ESCAPE '\\'`)
    ))
    .orderBy(
      // An exact name first, then names that start with the query, then folders
      // before files; the shortest name is the closest match, newest breaks ties.
      sql`${driveEntries.nameSearch} = ${whole} DESC`,
      sql`${driveEntries.nameSearch} LIKE ${`${escapeLike(terms[0]!)}%`} ESCAPE '\\' DESC`,
      sql`${driveEntries.type} = 'folder' DESC`,
      sql`length(${driveEntries.name}) ASC`,
      sql`${driveEntries.modified} DESC`
    )
    .limit(limit)

  return rows.map(row => ({
    service: row.service,
    path: row.path,
    name: row.name,
    parent: row.parent,
    type: row.type,
    modified: row.modified ?? undefined,
    size: row.size ?? undefined
  }))
}
