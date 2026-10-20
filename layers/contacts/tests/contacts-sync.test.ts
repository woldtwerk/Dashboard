import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, openSqlite } from '../../core/server/db/client'
import { loadMigrations, runMigrations } from '../../core/server/db/migrate'
import { diffCards } from '../server/contacts-sync/diff'
import { contactsAddressBooks, contactsCards, contactsSync } from '../server/db/cache-schema'
import { cachedContacts, CONTACTS_CACHE_VERSION, isContactsSyncStale } from '../server/utils/contacts-sync'
import type { ContactsCacheDb } from '../server/utils/contacts-sync'
import { CONTACTS_SYNC_STALE_MS } from '../shared/sync-schedule'

const vcard = (lines: string[]) => ['BEGIN:VCARD', 'VERSION:3.0', ...lines, 'END:VCARD', ''].join('\r\n')

const migrationsDir = fileURLToPath(new URL('../server/db/cache-migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

describe('diffCards', () => {
  it('upserts added and changed cards and removes the ones gone remotely', () => {
    const diff = diffCards(
      [
        { url: 'a.vcf', etag: '1' },
        { url: 'b.vcf', etag: '1' },
        { url: 'c.vcf', etag: '1' }
      ],
      [
        { url: 'a.vcf', etag: '1', data: 'a' },
        { url: 'b.vcf', etag: '2', data: 'b' },
        { url: 'd.vcf', etag: '1', data: 'd' }
      ]
    )

    expect(diff.upsert.map(card => card.url)).toEqual(['b.vcf', 'd.vcf'])
    expect(diff.removed).toEqual(['c.vcf'])
  })

  it('upserts a card without an etag, which cannot be proven unchanged', () => {
    const diff = diffCards([], [{ url: 'a.vcf', data: 'a' }])

    expect(diff.upsert.map(card => card.url)).toEqual(['a.vcf'])
  })
})

describe('isContactsSyncStale', () => {
  const now = new Date('2026-10-20T12:00:00.000Z').getTime()
  const fresh = { syncedAt: new Date(now - 1_000), version: CONTACTS_CACHE_VERSION }

  it('treats a service that never synced as stale', () => {
    expect(isContactsSyncStale(undefined, now)).toBe(true)
    expect(isContactsSyncStale({ syncedAt: null, version: CONTACTS_CACHE_VERSION }, now)).toBe(true)
  })

  it('refetches a cache stored by an older version', () => {
    expect(isContactsSyncStale({ ...fresh, version: CONTACTS_CACHE_VERSION - 1 }, now)).toBe(true)
    expect(isContactsSyncStale({ syncedAt: new Date(now), version: null }, now)).toBe(true)
  })

  it('keeps a cache synced exactly at the window', () => {
    expect(isContactsSyncStale(fresh, now)).toBe(false)
    expect(isContactsSyncStale({ ...fresh, syncedAt: new Date(now - CONTACTS_SYNC_STALE_MS) }, now)).toBe(false)
  })

  it('refetches once the window has passed', () => {
    expect(isContactsSyncStale({ ...fresh, syncedAt: new Date(now - CONTACTS_SYNC_STALE_MS - 1) }, now)).toBe(true)
  })
})

describe('cachedContacts', () => {
  let directory: string
  let sqlite: ReturnType<typeof openSqlite>
  let db: ContactsCacheDb

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'allmight-contacts-'))
    sqlite = openSqlite(join(directory, 'contacts.sqlite'))
    runMigrations(sqlite, await loadMigrations(readMigration))
    db = createDatabase(sqlite, { contactsAddressBooks, contactsCards, contactsSync })

    await db.insert(contactsCards).values([
      {
        service: 'svc',
        addressBookUrl: 'https://dav.example/friends/',
        url: 'https://dav.example/friends/jane.vcf',
        etag: '1',
        uid: 'jane@example.com',
        data: vcard(['UID:jane@example.com', 'FN:Jane Doe', 'EMAIL:jane@example.com'])
      },
      {
        service: 'svc',
        addressBookUrl: 'https://dav.example/friends/',
        url: 'https://dav.example/friends/nouid.vcf',
        etag: '2',
        uid: 'https://dav.example/friends/nouid.vcf',
        data: vcard(['FN:No UID'])
      },
      {
        service: 'svc',
        addressBookUrl: 'https://dav.example/work/',
        url: 'https://dav.example/work/bob.vcf',
        etag: '3',
        uid: 'bob@example.com',
        data: vcard(['UID:bob@example.com', 'FN:Bob Work'])
      },
      {
        service: 'other',
        addressBookUrl: 'https://dav.example/friends/',
        url: 'https://dav.example/friends/stranger.vcf',
        etag: '4',
        uid: 'stranger@example.com',
        data: vcard(['UID:stranger@example.com', 'FN:Stranger'])
      }
    ])
  })

  afterAll(async () => {
    sqlite.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('returns the parsed cards of the requested service and address book', async () => {
    const contacts = await cachedContacts('svc', 'https://dav.example/friends/', db)

    expect(contacts.map(contact => contact.uid)).toEqual([
      'jane@example.com',
      'https://dav.example/friends/nouid.vcf'
    ])
    expect(contacts[0]).toMatchObject({
      name: 'Jane Doe',
      url: 'https://dav.example/friends/jane.vcf',
      etag: '1',
      addressBook: 'https://dav.example/friends/'
    })
    expect(contacts[0]!.emails).toEqual([{ value: 'jane@example.com', label: undefined }])
  })
})
