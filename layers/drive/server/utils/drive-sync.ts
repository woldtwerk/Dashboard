import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import type { DriveEntry } from '../../shared/types/drive'
import {
  DRIVE_CRAWL_BUDGET_MS,
  DRIVE_CRAWL_PAUSE_MS,
  DRIVE_CRAWL_REFRESH_MS
} from '../../shared/sync-schedule'
import { driveCacheSchema } from '../db/cache'
import { driveEntries, driveFolders, driveSync } from '../db/cache-schema'
import { CRAWL_SEEDS, descendantPrefix, diffListing, shouldDescend } from '../drive-sync/listing'
import { normalizeSearchText } from '../drive-sync/search'
import type { DriveListingCache } from './drive-listing-cache'

// One CLI list may hold the container lock for up to COMMAND_TIMEOUT (300 s)
// and the crawl only renews between folders, so the lease has to outlive a
// single call with room to spare.
const LOCK_TTL_MS = 10 * 60_000

export type DriveCacheDb = SqliteRemoteDatabase<typeof driveCacheSchema>
type CacheTransaction = Parameters<Parameters<DriveCacheDb['transaction']>[0]>[0]

// One connection per worker is shared by every request, and a transaction spans
// awaits, so the worker's cache writes are queued instead of interleaving their
// BEGIN/COMMIT. Cross-worker writes are separated by SQLite itself.
let writeQueue: Promise<unknown> = Promise.resolve()

// One lease for every drive service: each service talks to the same Proton
// Drive CLI container, which runs every command under one lock, so a crawl of
// one service must never compete with a crawl of another or with a user's read.
const CRAWL_LOCK = 'drive-crawl'

function cacheDb(): Promise<DriveCacheDb> {
  return useCacheDb('drive', driveCacheSchema)
}

async function write<T>(db: DriveCacheDb | undefined, fn: (tx: CacheTransaction) => Promise<T>): Promise<T> {
  const cache = db ?? await cacheDb()
  const run = writeQueue.catch(() => {}).then(() => cache.transaction(fn))
  writeQueue = run

  return run
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The cache row of one listed entry. */
function toRow(service: string, entry: DriveEntry) {
  return {
    service,
    path: entry.path,
    parent: entry.parent,
    uid: entry.uid,
    name: entry.name,
    nameSearch: normalizeSearchText(entry.name),
    type: entry.type,
    size: entry.size ?? null,
    modified: entry.modified ?? null,
    mediaType: entry.mediaType ?? null,
    webUrl: entry.webUrl ?? null
  }
}

/** A stored child as the listing diff expects it. */
function toEntry(row: typeof driveEntries.$inferSelect): DriveEntry {
  return {
    uid: row.uid,
    name: row.name,
    type: row.type,
    parent: row.parent,
    path: row.path,
    size: row.size ?? undefined,
    modified: row.modified ?? undefined,
    mediaType: row.mediaType ?? undefined,
    webUrl: row.webUrl ?? undefined
  }
}

/**
 * Stores one folder listing in the crawl database: entries that disappeared are
 * dropped together with their descendants, changed entries are upserted, child
 * folders become due, and the folder itself is marked listed.
 * @returns whether the listing differed from what was stored before
 */
export async function recordDriveListing(
  service: string,
  folder: string,
  entries: DriveEntry[],
  db?: DriveCacheDb
): Promise<boolean> {
  const listedAt = new Date()

  return await write(db, async (tx) => {
    // The stored children and the diff live in the same transaction as the
    // writes, so a request mirroring this folder cannot change them in between.
    const rows = await tx.select().from(driveEntries)
      .where(and(eq(driveEntries.service, service), eq(driveEntries.parent, folder)))
    const diff = diffListing(rows.map(toEntry), entries)

    // A removed folder takes everything below it with it. Matching the prefix
    // with `substr` keeps `a`, `a b` and `ab` apart without escaping names.
    for (const path of diff.removed) {
      const prefix = descendantPrefix(path)
      await tx.delete(driveEntries).where(and(
        eq(driveEntries.service, service),
        or(eq(driveEntries.path, path), sql`substr(${driveEntries.path}, 1, ${prefix.length}) = ${prefix}`)
      ))
      await tx.delete(driveFolders).where(and(
        eq(driveFolders.service, service),
        or(eq(driveFolders.path, path), sql`substr(${driveFolders.path}, 1, ${prefix.length}) = ${prefix}`)
      ))
    }

    for (const entry of diff.upsert) {
      const row = toRow(service, entry)
      await tx.insert(driveEntries).values(row).onConflictDoUpdate({
        target: [driveEntries.service, driveEntries.path],
        set: {
          parent: row.parent,
          uid: row.uid,
          name: row.name,
          nameSearch: row.nameSearch,
          type: row.type,
          size: row.size,
          modified: row.modified,
          mediaType: row.mediaType,
          webUrl: row.webUrl
        }
      })
    }

    for (const entry of entries) {
      if (entry.type !== 'folder' || !shouldDescend(entry.path)) {
        continue
      }

      await tx.insert(driveFolders).values({
        service,
        path: entry.path,
        listedAt: null,
        error: null
      }).onConflictDoNothing()
    }

    await tx.insert(driveFolders).values({
      service,
      path: folder,
      listedAt,
      error: null
    }).onConflictDoUpdate({
      target: [driveFolders.service, driveFolders.path],
      set: { listedAt, error: null }
    })

    return diff.removed.length > 0 || diff.upsert.length > 0
  })
}

/** Makes the given folders due again, e.g. because a mutation changed them. */
export async function markDriveFoldersDue(service: string, paths: string[], db?: DriveCacheDb): Promise<void> {
  const unique = [...new Set(paths)]
  if (!unique.length) {
    return
  }

  await write(db, tx => tx.update(driveFolders).set({ listedAt: null })
    .where(and(eq(driveFolders.service, service), inArray(driveFolders.path, unique))))
}

/**
 * The next folder the crawl should list: one that was never listed, otherwise
 * the oldest one past the refresh window. Undefined when every folder is fresh.
 */
export async function nextDueFolder(service: string, now: number = Date.now(), db?: DriveCacheDb): Promise<string | undefined> {
  const cache = db ?? await cacheDb()

  const neverListed = await cache.select({ path: driveFolders.path }).from(driveFolders)
    .where(and(eq(driveFolders.service, service), isNull(driveFolders.listedAt)))
    .orderBy(asc(driveFolders.path))
    .get()

  if (neverListed) {
    return neverListed.path
  }

  const stale = await cache.select({ path: driveFolders.path }).from(driveFolders)
    .where(and(
      eq(driveFolders.service, service),
      lt(driveFolders.listedAt, new Date(now - DRIVE_CRAWL_REFRESH_MS))
    ))
    .orderBy(asc(driveFolders.listedAt), asc(driveFolders.path))
    .get()

  return stale?.path
}

/** Stores the failure of one folder and marks it listed, so the run does not retry it at once. */
async function markFolderFailed(service: string, path: string, error: unknown): Promise<void> {
  const message = errorMessage(error)
  const listedAt = new Date()

  await write(undefined, tx => tx.insert(driveFolders).values({ service, path, listedAt, error: message })
    .onConflictDoUpdate({
      target: [driveFolders.service, driveFolders.path],
      set: { listedAt, error: message }
    }))
}

/** A pass that found nothing due completed the whole tree. */
async function markSynced(service: string): Promise<void> {
  const syncedAt = new Date()

  await write(undefined, tx => tx.insert(driveSync).values({ service, syncedAt, error: null })
    .onConflictDoUpdate({ target: driveSync.service, set: { syncedAt, error: null } }))
}

async function markFailed(service: string, error: unknown): Promise<void> {
  const message = errorMessage(error)

  await write(undefined, tx => tx.insert(driveSync).values({ service, error: message })
    .onConflictDoUpdate({ target: driveSync.service, set: { error: message } }))
}

async function seedCrawl(service: string): Promise<void> {
  await write(undefined, async (tx) => {
    for (const path of CRAWL_SEEDS) {
      await tx.insert(driveFolders).values({ service, path, listedAt: null, error: null })
        .onConflictDoNothing()
    }
  })
}

function pause(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, DRIVE_CRAWL_PAUSE_MS))
}

/**
 * Walks the due folders of one drive service until the shared run deadline,
 * reusing a fresh listing from the shared cache instead of calling the CLI.
 * Runs on at most one cluster worker at a time, across every service.
 * @returns false when another worker is already crawling or the deadline passed
 */
export async function crawlDriveService(
  service: string,
  listing: DriveListingCache,
  deadline: number = Date.now() + DRIVE_CRAWL_BUDGET_MS
): Promise<boolean> {
  if (Date.now() >= deadline) {
    return false
  }

  const startedAt = new Date()
  const logger = useServiceLogger('drive', service)
  let changed = 0
  let ran = false
  let ok = false

  try {
    const result = await withLock(CRAWL_LOCK, LOCK_TTL_MS, async ({ renew }) => {
      ran = true
      logger.info('Crawl started')

      let attempts = 0
      let successes = 0

      try {
        await seedCrawl(service)
        const provider = await useDriveProvider(service)

        while (Date.now() < deadline) {
          const folder = await nextDueFolder(service)
          if (!folder) {
            await markSynced(service)
            await publishDomainEvent({ domain: 'drive', service, type: 'synced' })
            break
          }

          if (!await renew()) {
            logger.warn('Crawl lock lost', { folder })
            throw new Error(`Lost crawl lock for service ${service}`)
          }

          attempts++

          try {
            const stored = await listing.read(service, folder)
            const fresh = stored && Date.now() - stored.fetchedAt < listing.ttlMs
            const entries = fresh ? stored.entries : await provider.list(folder)

            if (!fresh) {
              await listing.store(service, folder, entries)
            }
            if (await recordDriveListing(service, folder, entries)) {
              changed++
            }
            successes++
          } catch (error) {
            // The CLI is busy with a user's read; leave the folder due for the next run
            if (listing.isBusy(error)) {
              logger.info('Drive is busy; crawl paused', { folder })
              break
            }

            await markFolderFailed(service, folder, error)
            logger.warn(`Could not crawl "${folder}"`, { error: errorMessage(error) })

            // A provider that fails the first folders is broken, not just one folder
            if (!successes && attempts >= 3) {
              throw error
            }

            await pause()
            continue
          }

          await pause()
        }

        ok = true
        return true
      } catch (error) {
        await markFailed(service, error).catch(markError => logger.error('Could not record the crawl error', { error: errorMessage(markError) }))
        await publishDomainEvent({ domain: 'drive', service, type: 'sync-failed' })
        logger.error('Crawl failed', { error: errorMessage(error) })
        throw error
      }
    })

    return result ?? false
  } finally {
    if (ran) {
      const durationMs = Date.now() - startedAt.getTime()
      logger.info('Crawl finished', { durationMs, changed })
      await recordSyncRun({ domain: 'drive', service, startedAt: startedAt.toISOString(), durationMs, ok, changed })
    }
  }
}

/**
 * Crawls the service when it has a due folder, or when no pass has completed
 * yet.
 * @returns false when the run deadline passed, it was fresh, or another worker
 * is already crawling
 */
export async function syncDriveIfStale(
  service: string,
  listing: DriveListingCache,
  deadline: number = Date.now() + DRIVE_CRAWL_BUDGET_MS
): Promise<boolean> {
  if (Date.now() >= deadline || await isLockHeld(CRAWL_LOCK)) {
    return false
  }

  const cache = await cacheDb()
  const [due, row] = await Promise.all([
    nextDueFolder(service),
    cache.select({ syncedAt: driveSync.syncedAt }).from(driveSync)
      .where(eq(driveSync.service, service)).get()
  ])

  if (!due && row?.syncedAt) {
    return false
  }

  return crawlDriveService(service, listing, deadline)
}

/** Drops every cached row of a removed service. */
export async function removeCachedDriveService(service: string): Promise<void> {
  await write(undefined, async (tx) => {
    await tx.delete(driveEntries).where(eq(driveEntries.service, service))
    await tx.delete(driveFolders).where(eq(driveFolders.service, service))
    await tx.delete(driveSync).where(eq(driveSync.service, service))
  })
}
