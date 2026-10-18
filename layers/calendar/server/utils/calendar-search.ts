import { inArray, sql } from 'drizzle-orm'
import { entityKey } from '../../../core/shared/entities'
import { HIGHLIGHT_POST_TAG, HIGHLIGHT_PRE_TAG } from '../../../core/shared/highlight'
import { calendarPreferences } from '../db/schema'
import { calendarCacheSchema } from '../db/cache'
import type { EventSource } from './calendar-ical'
import { expandEvents, parseCalendar } from './calendar-ical'
import type { CalendarCacheDb } from './calendar-sync'

type IcalComponent = ReturnType<typeof parseCalendar>
type IcalProperty = ReturnType<IcalComponent['getFirstProperty']>

/** The transaction the calendar cache writes run in; see `calendar-sync`. */
export type CalendarSearchTransaction = Parameters<Parameters<CalendarCacheDb['transaction']>[0]>[0]

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The searchable text of one iCalendar object, read from the master VEVENT.
 * Kept apart from the SQL so it can be unit-tested without a database.
 */
export interface EventSearchDocument {
  summary: string
  description: string
  location: string
  /** Names and addresses of ORGANIZER and ATTENDEE, space-separated */
  people: string
  categories: string
}

function propertyText(component: IcalComponent, name: string): string {
  return String(component.getFirstPropertyValue(name) ?? '').trim()
}

function personText(property: IcalProperty): string {
  if (!property) {
    return ''
  }

  const value = property.getFirstValue()
  const address = typeof value === 'string' ? value.trim().replace(/^mailto:/i, '') : ''
  const cn = property.getParameter('cn')
  const name = Array.isArray(cn) ? cn[0] : cn

  return [typeof name === 'string' ? name.trim() : '', address].filter(Boolean).join(' ')
}

/** Everyone named on the master event, organizer first, without duplicates */
function peopleText(master: IcalComponent): string {
  const people = [
    personText(master.getFirstProperty('organizer')),
    ...master.getAllProperties('attendee').map(personText)
  ].filter(Boolean)

  return [...new Set(people)].join(' ')
}

/**
 * The text document indexed for an event. `timeZone` is part of the signature
 * the cache indexes against; the document itself is zone-independent.
 */
export function eventSearchDocument(ics: string, timeZone: string): EventSearchDocument {
  void timeZone

  const components = parseCalendar(ics).getAllSubcomponents('vevent')
  const master = components.find(component => !component.getFirstProperty('recurrence-id')) ?? components[0]

  if (!master) {
    return { summary: '', description: '', location: '', people: '', categories: '' }
  }

  return {
    summary: propertyText(master, 'summary'),
    description: propertyText(master, 'description'),
    location: propertyText(master, 'location'),
    people: peopleText(master),
    categories: master.getAllProperties('categories')
      .flatMap(property => property.getValues())
      .map(value => String(value ?? ''))
      .join(' ')
      .trim()
  }
}

// --- Query building -------------------------------------------------------

export type FtsTokenizer = 'trigram' | 'unicode61'

/** FTS5 operators and quote characters that must not reach the MATCH expression */
const FTS_SYNTAX = /["(){}[\]:^*~\\+-]/g

/**
 * Turns free text into an FTS5 MATCH expression: syntax characters are dropped,
 * every remaining term is quoted and the terms are ANDed. With the trigram
 * tokenizer a term needs at least three characters, so shorter ones are skipped;
 * unicode61 can match them as prefixes instead.
 */
export function toFtsQuery(query: string, tokenizer: FtsTokenizer = 'trigram'): string {
  const terms = query.replace(FTS_SYNTAX, ' ').split(/\s+/).filter(Boolean)

  return terms.flatMap((term) => {
    if (term.length >= 3) {
      return [`"${term}"`]
    }
    return tokenizer === 'trigram' ? [] : [`${term}*`]
  }).join(' AND ')
}

/**
 * The tokenizer the stored index was created with; the migration uses trigram,
 * but an older or hand-built file may carry the unicode61 fallback. Reading the
 * schema keeps the query form in step with the table it runs against.
 */
async function indexTokenizer(cache: CalendarCacheDb): Promise<FtsTokenizer> {
  const rows = await cache.values<[string | null]>(
    sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calendar_search'`
  )

  return rows[0]?.[0]?.includes('trigram') ? 'trigram' : 'unicode61'
}

// --- Writing the index ----------------------------------------------------

/** Drops the indexed row of one object; safe when there is none. */
export function deleteSearchRow(tx: CalendarSearchTransaction, service: string, url: string): Promise<unknown> {
  return tx.run(sql`DELETE FROM calendar_search WHERE service = ${service} AND url = ${url}`)
}

/** Drops the indexed rows of the given object URLs of one service */
export async function deleteSearchRows(tx: CalendarSearchTransaction, service: string, urls: string[]): Promise<void> {
  if (!urls.length) {
    return
  }

  const list = sql.join(urls.map(url => sql`${url}`), sql`, `)
  await tx.run(sql`DELETE FROM calendar_search WHERE service = ${service} AND url IN (${list})`)
}

/** Drops every indexed row of a service; used when its objects are cleared. */
export function deleteSearchService(tx: CalendarSearchTransaction, service: string): Promise<unknown> {
  return tx.run(sql`DELETE FROM calendar_search WHERE service = ${service}`)
}

/** Replaces the indexed row of one object, so a repeated write cannot duplicate it. */
export async function indexSearchRow(tx: CalendarSearchTransaction, service: string, row: { url: string, data: string }, timeZone: string): Promise<void> {
  const document = eventSearchDocument(row.data, timeZone)

  await deleteSearchRow(tx, service, row.url)
  await tx.run(sql`INSERT INTO calendar_search (service, url, summary, description, location, people, categories)
    VALUES (${service}, ${row.url}, ${document.summary}, ${document.description}, ${document.location}, ${document.people}, ${document.categories})`)
}

// --- Reading the index ----------------------------------------------------

export interface CalendarSearchHit {
  service: string
  url: string
  /** DAV collection URL of the calendar the event lives in */
  calendar: string
  calendarName?: string
  calendarColor?: string
  summary: string
  /** Summary with highlight markers */
  summaryHighlight?: string
  /** Description excerpt with highlight markers; only when the description matched */
  snippet?: string
  start: string
  end: string
  allDay: boolean
  location?: string
  /** Entity key of the event, e.g. `event:svc:<calendar>|<uid>|<recurrenceId>` */
  ref: string
}

export interface SearchEventsOptions {
  limit?: number
  /** Cache database; defaults to the calendar cache of this worker */
  db?: CalendarCacheDb
  now?: Date
  timeZone?: string
  tokenizer?: FtsTokenizer
  /** Calendar URLs to leave out, e.g. the ones the user hid */
  excludeCalendars?: string[]
}

function cacheDb(): Promise<CalendarCacheDb> {
  return useCacheDb('calendar', calendarCacheSchema)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/**
 * The occurrence a result should point at: the next one from `now`, or the last
 * one before it for a series that already ended. A sparse rule is looked up in
 * ever wider windows, because the trigram match says nothing about the dates.
 */
function nearestOccurrence(data: string, source: EventSource, firstStart: Date, lastEnd: Date | null, now: Date, timeZone: string) {
  const hasFuture = lastEnd === null || lastEnd.getTime() > now.getTime()

  if (hasFuture) {
    for (const years of [1, 5, 30]) {
      const upcoming = expandEvents(data, source, { start: now, end: addDays(now, years * 366) }, timeZone)
      if (upcoming.length) {
        return upcoming[0]
      }
    }
  }

  const past = expandEvents(data, source, { start: addDays(firstStart, -1), end: now }, timeZone)
  return past[past.length - 1]
}

type SearchRow = [string, string, string, string, number, number | null, string, string | null, string | null, string | null, string | null]

/**
 * Full-text search across the given services' cached events, best match first.
 * Results carry the next occurrence (or the last one) and a highlighted summary
 * and description excerpt.
 */
export async function searchEvents(services: string[], query: string, options: SearchEventsOptions = {}): Promise<CalendarSearchHit[]> {
  const limit = options.limit ?? 30

  if (!services.length || limit <= 0 || !query.trim()) {
    return []
  }

  const now = options.now ?? new Date()
  const timeZone = options.timeZone ?? useRuntimeConfig().public.calendar.timeZone
  const cache = options.db ?? await cacheDb()
  const tokenizer = options.tokenizer ?? await indexTokenizer(cache)
  const match = toFtsQuery(query, tokenizer)

  if (!match) {
    return []
  }

  const serviceList = sql.join(services.map(service => sql`${service}`), sql`, `)
  const exclude = options.excludeCalendars ?? []
  const excludeClause = exclude.length
    ? sql` AND o.calendar_url NOT IN (${sql.join(exclude.map(url => sql`${url}`), sql`, `)})`
    : sql``

  const rows = await cache.values<SearchRow>(sql`
    SELECT o.service, o.url, o.calendar_url, o.data, o.first_start, o.last_end, o.uid,
      c.name, c.color,
      snippet(calendar_search, 2, ${HIGHLIGHT_PRE_TAG}, ${HIGHLIGHT_POST_TAG}, '…', 12),
      snippet(calendar_search, 3, ${HIGHLIGHT_PRE_TAG}, ${HIGHLIGHT_POST_TAG}, '…', 24)
    FROM calendar_search
    JOIN calendar_objects o ON o.service = calendar_search.service AND o.url = calendar_search.url
    LEFT JOIN calendar_collections c ON c.service = o.service AND c.url = o.calendar_url
    WHERE calendar_search MATCH ${match}
      AND calendar_search.service IN (${serviceList})${excludeClause}
    ORDER BY bm25(calendar_search)
    LIMIT ${limit}
  `)

  return rows.flatMap((row): CalendarSearchHit[] => {
    const [service, url, calendarUrl, data, firstStart, lastEnd, uid, calendarName, calendarColor, summaryHighlight, snippet] = row
    const source: EventSource = { url, calendar: calendarUrl, service }
    const occurrence = nearestOccurrence(data, source, new Date(firstStart), lastEnd === null ? null : new Date(lastEnd), now, timeZone)

    if (!occurrence) {
      return []
    }

    return [{
      service,
      url,
      calendar: calendarUrl,
      calendarName: calendarName ?? undefined,
      calendarColor: calendarColor ?? undefined,
      summary: occurrence.title,
      summaryHighlight: summaryHighlight ?? undefined,
      snippet: snippet?.includes(HIGHLIGHT_PRE_TAG) ? snippet : undefined,
      start: occurrence.start,
      end: occurrence.end,
      allDay: occurrence.allDay,
      location: occurrence.location,
      ref: entityKey({ type: 'event', service, id: [calendarUrl, uid, occurrence.recurrenceId ?? ''].join('|') })
    }]
  })
}

/** Calendar URLs the user hid; search results skip them. */
export async function hiddenCalendarUrls(services: string[]): Promise<string[]> {
  if (!services.length) {
    return []
  }

  const rows = await (await useDb()).select({
    url: calendarPreferences.calendarUrl,
    hidden: calendarPreferences.hidden
  }).from(calendarPreferences).where(inArray(calendarPreferences.service, services))

  return rows.filter(row => row.hidden).map(row => row.url)
}
