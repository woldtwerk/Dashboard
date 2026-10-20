import { and, eq, inArray } from 'drizzle-orm'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { CONTACTS_SYNC_STALE_MS } from '../../shared/sync-schedule'
import type { AddressBook, Contact } from '../../shared/types/contacts'
import { contactsCacheSchema } from '../db/cache'
import { contactsAddressBooks, contactsCards, contactsSync } from '../db/cache-schema'
import { diffCards } from '../contacts-sync/diff'
import type { ContactsProvider, RemoteAddressBook, RemoteCard } from './contacts-provider'
import { parseVCard, readVCardUid } from './vcard'

const LOCK_TTL_MS = 5 * 60_000
/** SQLite limits bound parameters per statement */
const SQL_CHUNK = 500

/** Bump when the stored cards change meaning, so an outdated cache refetches */
export const CONTACTS_CACHE_VERSION = 1

export type ContactsCacheDb = SqliteRemoteDatabase<typeof contactsCacheSchema>
type CacheTransaction = Parameters<Parameters<ContactsCacheDb['transaction']>[0]>[0]

// One connection per worker is shared by every request, and a transaction spans
// awaits, so the worker's cache writes are queued instead of interleaving their
// BEGIN/COMMIT. Cross-worker writes are separated by SQLite itself.
let writeQueue: Promise<unknown> = Promise.resolve()

const lockName = (service: string) => `contacts-sync:${service}`

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))

function cacheDb(): Promise<ContactsCacheDb> {
  return useCacheDb('contacts', contactsCacheSchema)
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

function toRow(service: string, addressBookUrl: string, card: RemoteCard) {
  return {
    service,
    addressBookUrl,
    url: card.url,
    etag: card.etag ?? null,
    // A card without a UID is identified by its object URL
    uid: readVCardUid(card.data) ?? card.url,
    data: card.data
  }
}

async function upsertCardRow(tx: CacheTransaction, row: ReturnType<typeof toRow>): Promise<void> {
  await tx.insert(contactsCards).values(row).onConflictDoUpdate({
    target: [contactsCards.service, contactsCards.url],
    set: {
      addressBookUrl: row.addressBookUrl,
      etag: row.etag,
      uid: row.uid,
      data: row.data
    }
  })
}

/** Stores one already-fetched card, e.g. after a write through the provider. */
async function cacheCard(service: string, addressBookUrl: string, card: RemoteCard): Promise<void> {
  const row = toRow(service, addressBookUrl, card)
  await write(tx => upsertCardRow(tx, row))
}

/** Drops one cached card by href, e.g. after it was deleted remotely. */
export async function removeCachedCard(service: string, url: string): Promise<void> {
  await write(tx => tx.delete(contactsCards).where(and(eq(contactsCards.service, service), eq(contactsCards.url, url))))
}

/** Drops every cached row of a removed service. */
export async function removeCachedContactsService(service: string): Promise<void> {
  await write(async (tx) => {
    await tx.delete(contactsCards).where(eq(contactsCards.service, service))
    await tx.delete(contactsAddressBooks).where(eq(contactsAddressBooks.service, service))
    await tx.delete(contactsSync).where(eq(contactsSync.service, service))
  })
}

/** Refetches one card after a create or update, so the next read sees it. */
export async function refreshCachedCard(service: string, addressBookUrl: string, url: string): Promise<void> {
  const provider = await useContactsProvider(service)
  const card = await provider.fetchCard(addressBookUrl, url)

  if (!card) {
    await removeCachedCard(service, url)
    return
  }

  await cacheCard(service, addressBookUrl, card)
}

/**
 * Brings the cache in step after a successful remote write. A failing cache
 * refresh must not turn a saved create, update or delete into an error — a
 * retry could duplicate the write — so it is logged and left to the next sync.
 */
export async function syncCachedCardAfterWrite(
  service: string,
  addressBookUrl: string,
  url: string,
  { removed = false }: { removed?: boolean } = {}
): Promise<void> {
  try {
    if (removed) {
      await removeCachedCard(service, url)
      return
    }

    await refreshCachedCard(service, addressBookUrl, url)
  } catch (error) {
    useServiceLogger('contacts', service).warn('Could not update the contacts cache', { error: errorMessage(error) })
  }
}

async function markSynced(service: string): Promise<void> {
  const syncedAt = new Date()

  await write(tx => tx.insert(contactsSync).values({ service, syncedAt, error: null, version: CONTACTS_CACHE_VERSION })
    .onConflictDoUpdate({ target: contactsSync.service, set: { syncedAt, error: null, version: CONTACTS_CACHE_VERSION } }))
}

async function markFailed(service: string, error: unknown): Promise<void> {
  const message = errorMessage(error)

  await write(tx => tx.insert(contactsSync).values({ service, error: message })
    .onConflictDoUpdate({ target: contactsSync.service, set: { error: message } }))
}

/**
 * Drops the cached cards of a service stored under an older cache version, so
 * the next sync recomputes them and the ctag forces a full refetch.
 */
async function ensureCacheVersion(service: string): Promise<void> {
  const db = await cacheDb()
  const row = await db.select({ version: contactsSync.version }).from(contactsSync)
    .where(eq(contactsSync.service, service)).get()

  if (!row || row.version === CONTACTS_CACHE_VERSION) {
    return
  }

  await write(async (tx) => {
    await tx.delete(contactsCards).where(eq(contactsCards.service, service))
    await tx.update(contactsAddressBooks).set({ ctag: null, syncToken: null }).where(eq(contactsAddressBooks.service, service))
  })
}

/** Stores the address book list, dropping cards of books gone from the server. */
async function syncAddressBooks(service: string, addressBooks: RemoteAddressBook[]): Promise<Map<string, string | null>> {
  const db = await cacheDb()
  const known = await db.select({ url: contactsAddressBooks.url, ctag: contactsAddressBooks.ctag })
    .from(contactsAddressBooks).where(eq(contactsAddressBooks.service, service))
  const remoteUrls = new Set(addressBooks.map(book => book.url))
  const gone = known.filter(row => !remoteUrls.has(row.url)).map(row => row.url)

  await write(async (tx) => {
    for (const urls of chunk(gone, SQL_CHUNK)) {
      await tx.delete(contactsCards).where(and(eq(contactsCards.service, service), inArray(contactsCards.addressBookUrl, urls)))
      await tx.delete(contactsAddressBooks).where(and(eq(contactsAddressBooks.service, service), inArray(contactsAddressBooks.url, urls)))
    }

    for (const book of addressBooks) {
      await tx.insert(contactsAddressBooks).values({
        service,
        url: book.url,
        name: book.name,
        description: book.description ?? null
      }).onConflictDoUpdate({
        target: [contactsAddressBooks.service, contactsAddressBooks.url],
        // The ctag and sync token stay until this run's cards are stored
        set: {
          name: book.name,
          description: book.description ?? null
        }
      })
    }
  })

  return new Map(known.map(row => [row.url, row.ctag]))
}

/** Diffs and refreshes the cards of one address book; returns the cards upserted or removed. */
async function syncCards(service: string, addressBook: RemoteAddressBook, provider: ContactsProvider): Promise<number> {
  const db = await cacheDb()
  const where = and(eq(contactsCards.service, service), eq(contactsCards.addressBookUrl, addressBook.url))
  const [remote, stored] = await Promise.all([
    provider.fetchCards(addressBook.url),
    db.select({ url: contactsCards.url, etag: contactsCards.etag }).from(contactsCards).where(where)
  ])
  const diff = diffCards(stored.map(row => ({ url: row.url, etag: row.etag ?? undefined })), remote)
  const rows = diff.upsert.map(card => toRow(service, addressBook.url, card))

  await write(async (tx) => {
    for (const urls of chunk(diff.removed, SQL_CHUNK)) {
      await tx.delete(contactsCards).where(and(eq(contactsCards.service, service), eq(contactsCards.addressBookUrl, addressBook.url), inArray(contactsCards.url, urls)))
    }

    for (const row of rows) {
      await upsertCardRow(tx, row)
    }

    await tx.update(contactsAddressBooks).set({
      ctag: addressBook.ctag ?? null,
      syncToken: addressBook.syncToken ?? null
    }).where(and(eq(contactsAddressBooks.service, service), eq(contactsAddressBooks.url, addressBook.url)))
  })

  if (diff.removed.length || rows.length) {
    await publishDomainEvent({ domain: 'contacts', service, type: 'changed', resource: addressBook.url })
  }

  return diff.removed.length + rows.length
}

/**
 * Brings the contact cache of one contacts service up to date.
 * Runs on at most one cluster worker per service at a time.
 * @returns false when another worker is already syncing
 */
export async function syncContactsService(service: string): Promise<boolean> {
  const startedAt = new Date()
  const logger = useServiceLogger('contacts', service)
  let changed = 0
  let ran = false
  let ok = false

  try {
    const result = await withLock(lockName(service), LOCK_TTL_MS, async ({ renew }) => {
      ran = true
      logger.info('Sync started')

      try {
        // A cache stored before the cards were fixed has to be refetched
        await ensureCacheVersion(service)
        const provider = await useContactsProvider(service)
        const addressBooks = await provider.listAddressBooks()
        const stored = await syncAddressBooks(service, addressBooks)

        for (const addressBook of addressBooks) {
          if (!await renew()) {
            logger.warn('Sync lock lost', { addressBook: addressBook.url })
            throw new Error(`Lost sync lock for service ${service}`)
          }

          // Without a ctag there is no cheap way to know: diff every time
          if (addressBook.ctag && stored.get(addressBook.url) === addressBook.ctag) {
            continue
          }

          changed += await syncCards(service, addressBook, provider)
        }

        await markSynced(service)
        await publishDomainEvent({ domain: 'contacts', service, type: 'synced' })
        ok = true
        return true
      } catch (error) {
        await markFailed(service, error).catch(markError => logger.error('Could not record the sync error', { error: errorMessage(markError) }))
        await publishDomainEvent({ domain: 'contacts', service, type: 'sync-failed' })
        logger.error('Sync failed', { error: errorMessage(error) })
        throw error
      }
    })

    return result ?? false
  } finally {
    if (ran) {
      const durationMs = Date.now() - startedAt.getTime()
      logger.info('Sync finished', { durationMs, changed })
      await recordSyncRun({ domain: 'contacts', service, startedAt: startedAt.toISOString(), durationMs, ok, changed })
    }
  }
}

/** Whether the cache of the service has to be refetched: never synced, stored by an older cache version, or stale */
export function isContactsSyncStale(
  row: { syncedAt: Date | null, version: number | null } | undefined,
  now: number = Date.now()
): boolean {
  return !row?.syncedAt || row.version !== CONTACTS_CACHE_VERSION || now - row.syncedAt.getTime() > CONTACTS_SYNC_STALE_MS
}

/**
 * Syncs the cache of the service when it is stale.
 * @returns false when it was fresh or another worker is already syncing
 */
export async function syncContactsIfStale(service: string): Promise<boolean> {
  if (await isLockHeld(lockName(service))) {
    return false
  }

  const db = await cacheDb()
  const row = await db.select({ syncedAt: contactsSync.syncedAt, version: contactsSync.version }).from(contactsSync)
    .where(eq(contactsSync.service, service)).get()

  if (!isContactsSyncStale(row)) {
    return false
  }

  return syncContactsService(service)
}

/** Starts a background sync when the cache of the service is stale; never waits for it */
export async function requestContactsSync(service: string): Promise<void> {
  syncContactsIfStale(service).catch((error) => {
    useServiceLogger('contacts', service).error('Background sync failed', { error: errorMessage(error) })
  })
}

/** First visit waits for the initial sync; later visits answer from the cache. */
export async function ensureContactsSynced(service: string): Promise<void> {
  // A removed service's rows are cleaned up by the plugin; never serve them either way
  await getService(service, 'contacts')

  const db = await cacheDb()
  const row = await db.select({ syncedAt: contactsSync.syncedAt }).from(contactsSync)
    .where(eq(contactsSync.service, service)).get()

  if (!row?.syncedAt) {
    await syncContactsService(service)
    return
  }

  await requestContactsSync(service)
}

/** Address books of a service as the last sync stored them. */
export async function cachedAddressBooks(service: string): Promise<AddressBook[]> {
  const db = await cacheDb()
  const rows = await db.select({
    url: contactsAddressBooks.url,
    name: contactsAddressBooks.name,
    description: contactsAddressBooks.description
  }).from(contactsAddressBooks).where(eq(contactsAddressBooks.service, service))

  return rows.map(row => ({
    url: row.url,
    name: row.name,
    description: row.description ?? undefined
  }))
}

/** Contacts of a service (or one address book), parsed from the cached vCards. */
export async function cachedContacts(service: string, addressBookUrl?: string, db?: ContactsCacheDb): Promise<Contact[]> {
  const cache = db ?? await cacheDb()
  const rows = await cache.select({
    url: contactsCards.url,
    etag: contactsCards.etag,
    addressBookUrl: contactsCards.addressBookUrl,
    data: contactsCards.data
  }).from(contactsCards).where(addressBookUrl
    ? and(eq(contactsCards.service, service), eq(contactsCards.addressBookUrl, addressBookUrl))
    : eq(contactsCards.service, service)
  )

  return rows.sort((a, b) => a.url.localeCompare(b.url)).map((row) => {
    const parsed = parseVCard(row.data)

    return {
      ...parsed,
      // A card without a UID is identified by its object URL
      uid: parsed.uid || row.url,
      url: row.url,
      etag: row.etag ?? undefined,
      addressBook: row.addressBookUrl
    }
  })
}
