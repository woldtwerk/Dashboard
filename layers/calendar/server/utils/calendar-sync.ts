import { and, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import type { Calendar, CalendarEvent, CalendarSyncStatus } from '../../shared/types/calendar'
import { calendarCacheSchema } from '../db/cache'
import { calendarCollections, calendarObjects, calendarSync } from '../db/cache-schema'
import { objectBounds } from '../calendar-sync/bounds'
import { diffObjects } from '../calendar-sync/diff'
import { expandEvents } from './calendar-ical'
import type { CalendarProvider, RemoteCalendarObject } from './calendar-provider'

const LOCK_TTL_MS = 5 * 60_000
const STALE_MS = 2 * 60_000
/** SQLite limits bound parameters per statement */
const SQL_CHUNK = 500

/** Bump when the stored bounds change meaning, so an outdated cache refetches */
export const CALENDAR_CACHE_VERSION = 2

export type CalendarCacheDb = SqliteRemoteDatabase<typeof calendarCacheSchema>
type CacheTransaction = Parameters<Parameters<CalendarCacheDb['transaction']>[0]>[0]

// One connection per worker is shared by every request, and a transaction spans
// awaits, so the worker's cache writes are queued instead of interleaving their
// BEGIN/COMMIT. Cross-worker writes are separated by SQLite itself.
let writeQueue: Promise<unknown> = Promise.resolve()

const lockName = (service: string) => `calendar-sync:${service}`

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))

function cacheDb(): Promise<CalendarCacheDb> {
  return useCacheDb('calendar', calendarCacheSchema)
}

function write<T>(fn: (tx: CacheTransaction) => Promise<T>): Promise<T> {
  const run = writeQueue.catch(() => {}).then(async () => {
    const db = await cacheDb()
    return db.transaction(fn)
  })
  writeQueue = run

  return run
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The zone a floating iCalendar time is placed in, from the runtime config */
function calendarTimeZone(): string {
  return useRuntimeConfig().public.calendar.timeZone
}

function toRows(service: string, calendarUrl: string, objects: RemoteCalendarObject[], fallbackZone: string) {
  return objects.map((object) => {
    if (!object.data) {
      throw new Error('The calendar server returned an object without data')
    }

    const bounds = objectBounds(object.data, fallbackZone)

    return {
      service,
      calendarUrl,
      url: object.url,
      etag: object.etag ?? null,
      uid: bounds.uid,
      data: object.data,
      firstStart: bounds.firstStart,
      lastEnd: bounds.lastEnd
    }
  })
}

async function upsertRows(service: string, rows: ReturnType<typeof toRows>): Promise<void> {
  if (!rows.length) {
    return
  }

  await write(async (tx) => {
    for (const row of rows) {
      await tx.insert(calendarObjects).values(row).onConflictDoUpdate({
        target: [calendarObjects.service, calendarObjects.url],
        set: {
          calendarUrl: row.calendarUrl,
          etag: row.etag,
          uid: row.uid,
          data: row.data,
          firstStart: row.firstStart,
          lastEnd: row.lastEnd
        }
      })
    }
  })
}

/** Stores one already-fetched object, e.g. after a write through the provider. */
export async function cacheCalendarObject(service: string, calendarUrl: string, object: RemoteCalendarObject): Promise<void> {
  await upsertRows(service, toRows(service, calendarUrl, [object], calendarTimeZone()))
}

/** Drops one cached object by href, e.g. after it was deleted remotely. */
export async function removeCachedObject(service: string, url: string): Promise<void> {
  await write(tx => tx.delete(calendarObjects).where(and(eq(calendarObjects.service, service), eq(calendarObjects.url, url))))
}

/** Drops every cached row of a removed service. */
export async function removeCachedService(service: string): Promise<void> {
  await write(async (tx) => {
    await tx.delete(calendarObjects).where(eq(calendarObjects.service, service))
    await tx.delete(calendarCollections).where(eq(calendarCollections.service, service))
    await tx.delete(calendarSync).where(eq(calendarSync.service, service))
  })
}

/** Refetches one object after a create or update, so the next read sees it. */
export async function refreshCalendarObject(service: string, calendarUrl: string, url: string): Promise<void> {
  const provider = await useCalendarProvider(service)
  const [object] = await provider.fetchObjects(calendarUrl, [url])

  if (!object) {
    await removeCachedObject(service, url)
    return
  }

  await cacheCalendarObject(service, calendarUrl, object)
}

async function markSynced(service: string): Promise<void> {
  const syncedAt = new Date()

  await write(tx => tx.insert(calendarSync).values({ service, syncedAt, error: null, version: CALENDAR_CACHE_VERSION })
    .onConflictDoUpdate({ target: calendarSync.service, set: { syncedAt, error: null, version: CALENDAR_CACHE_VERSION } }))
}

async function markFailed(service: string, error: unknown): Promise<void> {
  const message = errorMessage(error)

  await write(tx => tx.insert(calendarSync).values({ service, error: message })
    .onConflictDoUpdate({ target: calendarSync.service, set: { error: message } }))
}

/**
 * Drops the cached objects of a service stored under an older cache version, so
 * the next sync recomputes their bounds and the ctag forces a full refetch.
 */
async function ensureCacheVersion(service: string): Promise<void> {
  const db = await cacheDb()
  const row = await db.select({ version: calendarSync.version }).from(calendarSync)
    .where(eq(calendarSync.service, service)).get()

  if (!row || row.version === CALENDAR_CACHE_VERSION) {
    return
  }

  await write(async (tx) => {
    await tx.delete(calendarObjects).where(eq(calendarObjects.service, service))
    await tx.update(calendarCollections).set({ ctag: null, syncToken: null }).where(eq(calendarCollections.service, service))
  })
}

/** Stores the calendar list, dropping objects of calendars gone from the server. */
async function syncCollections(service: string, calendars: Calendar[]): Promise<Map<string, string | null>> {
  const db = await cacheDb()
  const known = await db.select({ url: calendarCollections.url, ctag: calendarCollections.ctag })
    .from(calendarCollections).where(eq(calendarCollections.service, service))
  const remoteUrls = new Set(calendars.map(calendar => calendar.url))
  const gone = known.filter(row => !remoteUrls.has(row.url)).map(row => row.url)

  await write(async (tx) => {
    for (const urls of chunk(gone, SQL_CHUNK)) {
      await tx.delete(calendarObjects).where(and(eq(calendarObjects.service, service), inArray(calendarObjects.calendarUrl, urls)))
      await tx.delete(calendarCollections).where(and(eq(calendarCollections.service, service), inArray(calendarCollections.url, urls)))
    }

    for (const calendar of calendars) {
      await tx.insert(calendarCollections).values({
        service,
        url: calendar.url,
        name: calendar.name,
        color: calendar.color ?? null,
        description: calendar.description ?? null
      }).onConflictDoUpdate({
        target: [calendarCollections.service, calendarCollections.url],
        // The ctag and sync token stay until this run's objects are stored
        set: {
          name: calendar.name,
          color: calendar.color ?? null,
          description: calendar.description ?? null
        }
      })
    }
  })

  return new Map(known.map(row => [row.url, row.ctag]))
}

/** Diffs and refreshes the objects of one calendar. */
async function syncObjects(service: string, calendar: Calendar, provider: CalendarProvider): Promise<void> {
  const db = await cacheDb()
  const where = and(eq(calendarObjects.service, service), eq(calendarObjects.calendarUrl, calendar.url))
  const [remote, cached] = await Promise.all([
    provider.listObjectEtags(calendar.url),
    db.select({ url: calendarObjects.url, etag: calendarObjects.etag }).from(calendarObjects).where(where)
  ])
  const diff = diffObjects(cached.map(row => ({ url: row.url, etag: row.etag ?? undefined })), remote)
  const byUrl = new Map(remote.map(object => [object.url, object]))

  // A CalDAV server returns the data with the etag listing; a provider that
  // cannot do that gets one multiget for the objects that actually changed.
  const missing = diff.changed.filter(url => !byUrl.get(url)?.data)
  if (missing.length) {
    for (const object of await provider.fetchObjects(calendar.url, missing)) {
      byUrl.set(object.url, object)
    }
  }

  const changed = diff.changed.map((url) => {
    const object = byUrl.get(url)
    if (!object) {
      throw new Error('The calendar server did not return a changed object')
    }
    return object
  })
  const rows = toRows(service, calendar.url, changed, calendarTimeZone())
  const syncedAt = new Date()

  await write(async (tx) => {
    for (const urls of chunk(diff.removed, SQL_CHUNK)) {
      await tx.delete(calendarObjects).where(and(eq(calendarObjects.service, service), eq(calendarObjects.calendarUrl, calendar.url), inArray(calendarObjects.url, urls)))
    }

    for (const row of rows) {
      await tx.insert(calendarObjects).values(row).onConflictDoUpdate({
        target: [calendarObjects.service, calendarObjects.url],
        set: {
          calendarUrl: row.calendarUrl,
          etag: row.etag,
          uid: row.uid,
          data: row.data,
          firstStart: row.firstStart,
          lastEnd: row.lastEnd
        }
      })
    }

    await tx.update(calendarCollections).set({
      ctag: calendar.ctag ?? null,
      syncToken: calendar.syncToken ?? null,
      syncedAt
    }).where(and(eq(calendarCollections.service, service), eq(calendarCollections.url, calendar.url)))
  })
}

/**
 * Brings the event cache of one calendar service up to date.
 * Runs on at most one cluster worker per service at a time.
 * @returns false when another worker is already syncing
 */
export async function syncCalendarService(service: string): Promise<boolean> {
  const result = await withLock(lockName(service), LOCK_TTL_MS, async ({ renew }) => {
    try {
      // A cache stored before the bounds were fixed has to be refetched
      await ensureCacheVersion(service)
      const provider = await useCalendarProvider(service)
      const calendars = await provider.listCalendars()
      const storedCtags = await syncCollections(service, calendars)

      for (const calendar of calendars) {
        if (!await renew()) {
          throw new Error(`Lost sync lock for service ${service}`)
        }

        // Without a ctag there is no cheap way to know: diff every time
        if (calendar.ctag && storedCtags.get(calendar.url) === calendar.ctag) {
          continue
        }

        await syncObjects(service, calendar, provider)
      }

      await markSynced(service)
      return true
    } catch (error) {
      await markFailed(service, error).catch(markError => console.error(`[calendar] Could not record the sync error of ${service}:`, markError))
      throw error
    }
  })

  return result ?? false
}

/** Starts a background sync when the cache of the service is stale; never waits for it */
export async function requestCalendarSync(service: string): Promise<void> {
  if (await isLockHeld(lockName(service))) {
    return
  }

  const db = await cacheDb()
  const row = await db.select({ syncedAt: calendarSync.syncedAt, version: calendarSync.version }).from(calendarSync)
    .where(eq(calendarSync.service, service)).get()

  if (!row?.syncedAt || row.version !== CALENDAR_CACHE_VERSION || Date.now() - row.syncedAt.getTime() > STALE_MS) {
    syncCalendarService(service).catch((error) => {
      console.error(`[calendar] Sync of ${service} failed:`, error)
    })
  }
}

/** First visit waits for the initial sync; later visits answer from the cache. */
export async function ensureCalendarSynced(service: string): Promise<void> {
  // A removed service's rows are cleaned up by the plugin; never serve them either way
  await getService(service, 'calendar')

  const db = await cacheDb()
  const row = await db.select({ syncedAt: calendarSync.syncedAt }).from(calendarSync)
    .where(eq(calendarSync.service, service)).get()

  if (!row?.syncedAt) {
    await syncCalendarService(service)
    return
  }

  await requestCalendarSync(service)
}

export async function getCalendarSyncStatus(service: string): Promise<CalendarSyncStatus> {
  const db = await cacheDb()
  const [row, syncing] = await Promise.all([
    db.select().from(calendarSync).where(eq(calendarSync.service, service)).get(),
    isLockHeld(lockName(service))
  ])

  return {
    service,
    syncing,
    syncedAt: row?.syncedAt?.toISOString() ?? null,
    error: row?.error ?? undefined
  }
}

/** Calendars of a service as the last sync stored them. */
export interface CachedCalendar {
  url: string
  name: string
  color?: string
  description?: string
  ctag?: string
  syncToken?: string
}

export async function cachedCalendars(service: string): Promise<CachedCalendar[]> {
  const db = await cacheDb()
  const rows = await db.select({
    url: calendarCollections.url,
    name: calendarCollections.name,
    color: calendarCollections.color,
    description: calendarCollections.description,
    ctag: calendarCollections.ctag,
    syncToken: calendarCollections.syncToken
  }).from(calendarCollections).where(eq(calendarCollections.service, service))

  return rows.map(row => ({
    url: row.url,
    name: row.name,
    color: row.color ?? undefined,
    description: row.description ?? undefined,
    ctag: row.ctag ?? undefined,
    syncToken: row.syncToken ?? undefined
  }))
}

/** Events of the given calendars that can overlap the window, expanded. */
export async function cachedEvents(
  service: string,
  calendarUrls: string[],
  window: { start: string, end: string },
  fallbackZone: string,
  db?: CalendarCacheDb
): Promise<CalendarEvent[]> {
  if (!calendarUrls.length) {
    return []
  }

  const cache = db ?? await cacheDb()
  const rows: { url: string, etag: string | null, calendarUrl: string, data: string }[] = []

  for (const urls of chunk(calendarUrls, SQL_CHUNK)) {
    rows.push(...await cache.select({
      url: calendarObjects.url,
      etag: calendarObjects.etag,
      calendarUrl: calendarObjects.calendarUrl,
      data: calendarObjects.data
    }).from(calendarObjects).where(and(
      eq(calendarObjects.service, service),
      inArray(calendarObjects.calendarUrl, urls),
      lt(calendarObjects.firstStart, new Date(window.end)),
      or(isNull(calendarObjects.lastEnd), gt(calendarObjects.lastEnd, new Date(window.start)))
    )))
  }

  return rows.sort((a, b) => a.url.localeCompare(b.url)).flatMap(row => expandEvents(row.data, {
    url: row.url,
    etag: row.etag ?? undefined,
    calendar: row.calendarUrl,
    service
  }, { start: new Date(window.start), end: new Date(window.end) }, fallbackZone))
}
