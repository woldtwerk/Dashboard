import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_PRE_TAG } from '../../core/shared/highlight'
import { createDatabase, openSqlite } from '../../core/server/db/client'
import { loadMigrations, runMigrations } from '../../core/server/db/migrate'
import { calendarCollections, calendarObjects, calendarSync } from '../server/db/cache-schema'
import {
  backfillCalendarSearch
} from '../server/utils/calendar-sync'
import type { CalendarCacheDb } from '../server/utils/calendar-sync'
import {
  deleteSearchRow,
  eventSearchDocument,
  indexSearchRow,
  searchEvents,
  toFtsQuery
} from '../server/utils/calendar-search'
import type { CalendarSearchTransaction } from '../server/utils/calendar-search'

const calendar = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`
const event = (lines: string[]) => calendar(['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n'))

const migrationsDir = fileURLToPath(new URL('../server/db/cache-migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

const TIME_ZONE = 'Europe/Berlin'
const NOW = new Date('2026-10-01T00:00:00.000Z')

describe('toFtsQuery', () => {
  it('quotes every term and ANDs them', () => {
    expect(toFtsQuery('Rechnung bezahlt')).toBe('"Rechnung" AND "bezahlt"')
  })

  it('drops FTS syntax characters', () => {
    expect(toFtsQuery('(Rechnung) "Oktober"')).toBe('"Rechnung" AND "Oktober"')
    expect(toFtsQuery('Rechnung*')).toBe('"Rechnung"')
  })

  it('skips terms shorter than three characters with the trigram tokenizer', () => {
    expect(toFtsQuery('ab Rechnung cd')).toBe('"Rechnung"')
    expect(toFtsQuery('a b')).toBe('')
  })

  it('matches short terms as prefixes with unicode61', () => {
    expect(toFtsQuery('ab Rechnung', 'unicode61')).toBe('ab* AND "Rechnung"')
  })
})

describe('eventSearchDocument', () => {
  it('reads the master event fields, people and categories', () => {
    const document = eventSearchDocument(event([
      'UID:rechnung@example.com',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'SUMMARY:Rechnung Strom',
      'DESCRIPTION:Die Rechnung fuer Oktober',
      'LOCATION:Buero Berlin',
      'CATEGORIES:Finanzen,Privat',
      'ORGANIZER;CN=Jane Doe:mailto:jane@example.com',
      'ATTENDEE;CN=Bob:mailto:bob@example.com'
    ]), TIME_ZONE)

    expect(document.summary).toBe('Rechnung Strom')
    expect(document.description).toBe('Die Rechnung fuer Oktober')
    expect(document.location).toBe('Buero Berlin')
    expect(document.people).toBe('Jane Doe jane@example.com Bob bob@example.com')
    expect(document.categories).toBe('Finanzen Privat')
  })

  it('ignores the override events of a series', () => {
    const document = eventSearchDocument(calendar([
      'BEGIN:VEVENT',
      'UID:series@example.com',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'SUMMARY:Master',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:series@example.com',
      'RECURRENCE-ID:20261006T090000Z',
      'DTSTART:20261006T100000Z',
      'DTEND:20261006T110000Z',
      'SUMMARY:Override',
      'END:VEVENT'
    ].join('\r\n')), TIME_ZONE)

    expect(document.summary).toBe('Master')
  })
})

interface TestCache {
  db: CalendarCacheDb
  write: <T>(fn: (tx: CalendarSearchTransaction) => Promise<T>) => Promise<T>
  close: () => Promise<void>
}

async function createCache(): Promise<TestCache> {
  const directory = await mkdtemp(join(tmpdir(), 'allmight-calendar-search-'))
  const sqlite = openSqlite(join(directory, 'calendar.sqlite'))
  runMigrations(sqlite, await loadMigrations(readMigration))
  const db = createDatabase(sqlite, { calendarCollections, calendarObjects, calendarSync })

  return {
    db,
    write: <T>(fn: (tx: CalendarSearchTransaction) => Promise<T>) => db.transaction(fn),
    async close() {
      sqlite.close()
      await rm(directory, { recursive: true, force: true })
    }
  }
}

async function addEvent(
  cache: TestCache,
  service: string,
  url: string,
  ics: string,
  options: { calendar?: string, firstStart?: Date, lastEnd?: Date | null } = {}
) {
  const calendarUrl = options.calendar ?? 'https://dav.example/cal/'
  const firstStart = options.firstStart ?? new Date('2026-10-05T09:00:00.000Z')

  await cache.write(async (tx) => {
    await tx.insert(calendarObjects).values({
      service,
      calendarUrl,
      url,
      etag: '1',
      uid: 'uid',
      data: ics,
      firstStart,
      lastEnd: options.lastEnd === undefined ? new Date('2026-10-05T10:00:00.000Z') : options.lastEnd
    })
    await indexSearchRow(tx, service, { url, data: ics }, TIME_ZONE)
  })
}

describe('searchEvents tokenizer fallback', () => {
  it('matches short terms as prefixes when the index uses unicode61', async () => {
    const cache = await createCache()
    await cache.db.run(sql`DROP TABLE calendar_search`)
    await cache.db.run(sql`CREATE VIRTUAL TABLE calendar_search USING fts5(service UNINDEXED, url UNINDEXED, summary, description, location, people, categories, tokenize='unicode61 remove_diacritics 2')`)
    await addEvent(cache, 'svc', 'https://dav.example/cal/a.ics', event([
      'UID:a@example.com',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'SUMMARY:Rechnung Strom'
    ]))

    // Two characters are too short for trigram; unicode61 matches them as a prefix
    const hits = await searchEvents(['svc'], 're', { db: cache.db, now: NOW, timeZone: TIME_ZONE })

    expect(hits).toHaveLength(1)
    await cache.close()
  })
})

describe('searchEvents', () => {
  it('finds a German compound by a substring and highlights the summary', async () => {
    const cache = await createCache()
    await cache.db.insert(calendarCollections).values({ service: 'svc', url: 'https://dav.example/cal/', name: 'Work', color: '#f00' })
    await addEvent(cache, 'svc', 'https://dav.example/cal/rechnung.ics', event([
      'UID:rechnung@example.com',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'SUMMARY:Rechnung Strom',
      'DESCRIPTION:Die Rechnung fuer Oktober'
    ]))

    const hits = await searchEvents(['svc'], 'chnun', { db: cache.db, now: NOW, timeZone: TIME_ZONE })

    expect(hits).toHaveLength(1)
    expect(hits[0]!.summary).toBe('Rechnung Strom')
    expect(hits[0]!.summaryHighlight).toContain(HIGHLIGHT_PRE_TAG)
    expect(hits[0]!.start).toBe('2026-10-05T09:00:00.000Z')
    expect(hits[0]!.calendarName).toBe('Work')
    expect(hits[0]!.ref).toBe('event:svc:' + encodeURIComponent('https://dav.example/cal/|uid|'))

    await cache.close()
  })

  it('points a recurring event at its next occurrence', async () => {
    const cache = await createCache()
    await addEvent(cache, 'svc', 'https://dav.example/cal/series.ics', event([
      'UID:series@example.com',
      'DTSTART:20260101T090000Z',
      'DTEND:20260101T093000Z',
      'RRULE:FREQ=DAILY',
      'SUMMARY:Tagesmeeting'
    ]), { firstStart: new Date('2026-01-01T09:00:00.000Z'), lastEnd: null })

    const hits = await searchEvents(['svc'], 'meeting', {
      db: cache.db,
      now: new Date('2026-10-05T12:00:00.000Z'),
      timeZone: TIME_ZONE
    })

    expect(hits).toHaveLength(1)
    expect(hits[0]!.start).toBe('2026-10-06T09:00:00.000Z')

    await cache.close()
  })

  it('leaves out a hidden calendar', async () => {
    const cache = await createCache()
    await addEvent(cache, 'svc', 'https://dav.example/cal/rechnung.ics', event([
      'UID:rechnung@example.com',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'SUMMARY:Rechnung Strom'
    ]))

    const hits = await searchEvents(['svc'], 'Rechnung', {
      db: cache.db,
      now: NOW,
      timeZone: TIME_ZONE,
      excludeCalendars: ['https://dav.example/cal/']
    })

    expect(hits).toEqual([])
    await cache.close()
  })

  it('reflects an update and a delete', async () => {
    const cache = await createCache()
    const url = 'https://dav.example/cal/item.ics'
    const first = event(['UID:item@example.com', 'DTSTART:20261005T090000Z', 'DTEND:20261005T100000Z', 'SUMMARY:Altbegriff'])
    const second = event(['UID:item@example.com', 'DTSTART:20261005T090000Z', 'DTEND:20261005T100000Z', 'SUMMARY:Neubegriff'])
    await addEvent(cache, 'svc', url, first)

    expect(await searchEvents(['svc'], 'Altbegriff', { db: cache.db, now: NOW, timeZone: TIME_ZONE })).toHaveLength(1)

    await cache.write(async (tx) => {
      await tx.update(calendarObjects).set({ data: second }).where(and(eq(calendarObjects.service, 'svc'), eq(calendarObjects.url, url)))
      await indexSearchRow(tx, 'svc', { url, data: second }, TIME_ZONE)
    })

    expect(await searchEvents(['svc'], 'Altbegriff', { db: cache.db, now: NOW, timeZone: TIME_ZONE })).toEqual([])
    expect(await searchEvents(['svc'], 'Neubegriff', { db: cache.db, now: NOW, timeZone: TIME_ZONE })).toHaveLength(1)

    await cache.write(async (tx) => {
      await tx.delete(calendarObjects).where(and(eq(calendarObjects.service, 'svc'), eq(calendarObjects.url, url)))
      await deleteSearchRow(tx, 'svc', url)
    })

    expect(await searchEvents(['svc'], 'Neubegriff', { db: cache.db, now: NOW, timeZone: TIME_ZONE })).toEqual([])
    await cache.close()
  })
})

describe('backfillCalendarSearch', () => {
  it('indexes cached objects that have no search row yet', async () => {
    const cache = await createCache()
    await addEvent(cache, 'svc', 'https://dav.example/cal/a.ics', event([
      'UID:a@example.com',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'SUMMARY:Rechnung Strom'
    ]))
    // Simulate a cache built before full-text search existed
    await cache.write(async (tx) => {
      await deleteSearchRow(tx, 'svc', 'https://dav.example/cal/a.ics')
    })

    const indexed = await backfillCalendarSearch(cache.db, cache.write, TIME_ZONE)
    expect(indexed).toBe(1)
    expect(await searchEvents(['svc'], 'Rechnung', { db: cache.db, now: NOW, timeZone: TIME_ZONE })).toHaveLength(1)

    // A populated index is left alone
    expect(await backfillCalendarSearch(cache.db, cache.write, TIME_ZONE)).toBe(0)
    await cache.close()
  })
})
