import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, openSqlite } from '../../core/server/db/client'
import { loadMigrations, runMigrations } from '../../core/server/db/migrate'
import { diffObjects } from '../server/calendar-sync/diff'
import { objectBounds } from '../server/calendar-sync/bounds'
import { calendarCollections, calendarObjects, calendarSync } from '../server/db/cache-schema'
import { cachedEvents, cachedEventsForParticipant } from '../server/utils/calendar-sync'
import type { CalendarCacheDb } from '../server/utils/calendar-sync'

const calendar = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`

const event = (lines: string[]) => calendar(['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n'))

const migrationsDir = fileURLToPath(new URL('../server/db/cache-migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

describe('objectBounds', () => {
  it('bounds a single event', () => {
    const bounds = objectBounds(event([
      'UID:single@example.com',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z'
    ]), 'Europe/Berlin')

    expect(bounds).toEqual({
      uid: 'single@example.com',
      firstStart: new Date('2026-10-05T09:00:00.000Z'),
      lastEnd: new Date('2026-10-05T10:00:00.000Z')
    })
  })

  it('reads an all-day event as UTC midnight', () => {
    const bounds = objectBounds(event([
      'UID:holiday@example.com',
      'DTSTART;VALUE=DATE:20261005',
      'DTEND;VALUE=DATE:20261006'
    ]), 'Europe/Berlin')

    expect(bounds.firstStart).toEqual(new Date('2026-10-05T00:00:00.000Z'))
    expect(bounds.lastEnd).toEqual(new Date('2026-10-06T00:00:00.000Z'))
  })

  it('takes the last occurrence of a rule with UNTIL', () => {
    const bounds = objectBounds(event([
      'UID:until@example.com',
      'DTSTART:20261001T090000Z',
      'DTEND:20261001T093000Z',
      'RRULE:FREQ=DAILY;UNTIL=20261003T090000Z'
    ]), 'Europe/Berlin')

    expect(bounds.firstStart).toEqual(new Date('2026-10-01T09:00:00.000Z'))
    expect(bounds.lastEnd).toEqual(new Date('2026-10-03T09:30:00.000Z'))
  })

  it('takes the last occurrence of a rule with COUNT', () => {
    const bounds = objectBounds(event([
      'UID:count@example.com',
      'DTSTART:20261001T090000Z',
      'DTEND:20261001T093000Z',
      'RRULE:FREQ=DAILY;COUNT=5'
    ]), 'Europe/Berlin')

    expect(bounds.lastEnd).toEqual(new Date('2026-10-05T09:30:00.000Z'))
  })

  it('leaves the end open for a series without an end', () => {
    const bounds = objectBounds(event([
      'UID:always@example.com',
      'DTSTART:20261001T090000Z',
      'DTEND:20261001T093000Z',
      'RRULE:FREQ=WEEKLY'
    ]), 'Europe/Berlin')

    expect(bounds.lastEnd).toBeNull()
  })

  it('extends the bounds with an override outside the series', () => {
    const bounds = objectBounds(calendar([
      'BEGIN:VEVENT',
      'UID:series@example.com',
      'DTSTART:20261001T090000Z',
      'DTEND:20261001T093000Z',
      'RRULE:FREQ=DAILY;COUNT=3',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:series@example.com',
      'RECURRENCE-ID:20261020T090000Z',
      'DTSTART:20261020T140000Z',
      'DTEND:20261020T150000Z',
      'END:VEVENT'
    ].join('\r\n')), 'Europe/Berlin')

    expect(bounds.firstStart).toEqual(new Date('2026-10-01T09:00:00.000Z'))
    expect(bounds.lastEnd).toEqual(new Date('2026-10-20T15:00:00.000Z'))
  })
})

describe('diffObjects', () => {
  it('reports added, changed, removed and unchanged objects', () => {
    const diff = diffObjects(
      [
        { url: 'a.ics', etag: '1' },
        { url: 'b.ics', etag: '1' },
        { url: 'c.ics', etag: '1' }
      ],
      [
        { url: 'a.ics', etag: '1' },
        { url: 'b.ics', etag: '2' },
        { url: 'd.ics', etag: '1' }
      ]
    )

    expect(diff.changed).toEqual(['b.ics', 'd.ics'])
    expect(diff.removed).toEqual(['c.ics'])
  })

  it('treats a new object without an etag as changed', () => {
    expect(diffObjects([], [{ url: 'a.ics' }])).toEqual({ changed: ['a.ics'], removed: [] })
  })
})

describe('cachedEvents', () => {
  let directory: string
  let sqlite: ReturnType<typeof openSqlite>
  let db: CalendarCacheDb

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'allmight-calendar-'))
    sqlite = openSqlite(join(directory, 'calendar.sqlite'))
    runMigrations(sqlite, await loadMigrations(readMigration))
    db = createDatabase(sqlite, { calendarCollections, calendarObjects, calendarSync })

    const single = event([
      'UID:single@example.com',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T100000Z',
      'SUMMARY:Single',
      'ORGANIZER:mailto:jane@example.com',
      'ATTENDEE:mailto:bob@example.com'
    ])
    const series = event([
      'UID:series@example.com',
      'DTSTART:20261001T090000Z',
      'DTEND:20261001T093000Z',
      'RRULE:FREQ=DAILY',
      'SUMMARY:Series'
    ])

    await db.insert(calendarObjects).values([
      {
        service: 'svc',
        calendarUrl: 'https://dav.example/cal/',
        url: 'https://dav.example/cal/single.ics',
        etag: '1',
        uid: 'single@example.com',
        data: single,
        participants: JSON.stringify(['bob@example.com', 'jane@example.com']),
        firstStart: new Date('2026-10-05T09:00:00.000Z'),
        lastEnd: new Date('2026-10-05T10:00:00.000Z')
      },
      {
        service: 'svc',
        calendarUrl: 'https://dav.example/cal/',
        url: 'https://dav.example/cal/series.ics',
        etag: '1',
        uid: 'series@example.com',
        data: series,
        firstStart: new Date('2026-10-01T09:00:00.000Z'),
        lastEnd: null
      }
    ])
  })

  afterAll(async () => {
    sqlite.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('expands the cached objects that overlap the window', async () => {
    const events = await cachedEvents('svc', ['https://dav.example/cal/'], {
      start: '2026-10-03T00:00:00.000Z',
      end: '2026-10-06T00:00:00.000Z'
    }, 'Europe/Berlin', db)

    expect(events.map(item => item.start).sort()).toEqual([
      '2026-10-03T09:00:00.000Z',
      '2026-10-04T09:00:00.000Z',
      '2026-10-05T09:00:00.000Z',
      '2026-10-05T09:00:00.000Z'
    ])
  })

  it('leaves out objects whose bounds do not reach the window', async () => {
    const events = await cachedEvents('svc', ['https://dav.example/cal/'], {
      start: '2026-10-04T00:00:00.000Z',
      end: '2026-10-04T23:00:00.000Z'
    }, 'Europe/Berlin', db)

    expect(events.map(item => item.start)).toEqual(['2026-10-04T09:00:00.000Z'])
  })
})

describe('cachedEventsForParticipant', () => {
  let directory: string
  let sqlite: ReturnType<typeof openSqlite>
  let db: CalendarCacheDb

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'allmight-calendar-'))
    sqlite = openSqlite(join(directory, 'calendar.sqlite'))
    runMigrations(sqlite, await loadMigrations(readMigration))
    db = createDatabase(sqlite, { calendarCollections, calendarObjects, calendarSync })

    await db.insert(calendarObjects).values({
      service: 'svc',
      calendarUrl: 'https://dav.example/cal/',
      url: 'https://dav.example/cal/meeting.ics',
      etag: '1',
      uid: 'meeting@example.com',
      data: event([
        'UID:meeting@example.com',
        'DTSTART:20261005T090000Z',
        'DTEND:20261005T100000Z',
        'SUMMARY:Meeting',
        'ORGANIZER:mailto:jane@example.com',
        'ATTENDEE:mailto:bob@example.com'
      ]),
      participants: JSON.stringify(['bob@example.com', 'jane@example.com']),
      firstStart: new Date('2026-10-05T09:00:00.000Z'),
      lastEnd: new Date('2026-10-05T10:00:00.000Z')
    })
  })

  afterAll(async () => {
    sqlite.close()
    await rm(directory, { recursive: true, force: true })
  })

  const window = { start: '2026-10-03T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' }

  it('returns the events an address takes part in, with their organizer', async () => {
    const events = await cachedEventsForParticipant('svc', 'jane@example.com', window, 'Europe/Berlin', db)

    expect(events.map(item => item.event.uid)).toEqual(['meeting@example.com'])
    expect(events[0]!.organizer).toBe('jane@example.com')
  })

  it('returns an attendee with the organizer still named', async () => {
    const events = await cachedEventsForParticipant('svc', 'bob@example.com', window, 'Europe/Berlin', db)

    expect(events).toHaveLength(1)
    expect(events[0]!.organizer).toBe('jane@example.com')
  })

  it('does not return events for a stranger', async () => {
    expect(await cachedEventsForParticipant('svc', 'stranger@example.com', window, 'Europe/Berlin', db)).toEqual([])
  })
})
