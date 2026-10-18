import type { MailIndexQuery } from '../../../mail/server/utils/mail-search-index'
import { normalizeSenderTerm } from '../../../mail/server/mail-index/document'
import { normalizeEmail } from '../../../core/shared/entities'

/** Quotes a value for a Meilisearch filter expression */
export function filterValue(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

const unixSeconds = (isoDate: string) => Math.floor(new Date(`${isoDate}T00:00:00Z`).getTime() / 1000)

const DAY_MS = 24 * 60 * 60 * 1000
const dayKey = (date: Date) => date.toISOString().slice(0, 10)

export interface DayCountQuery {
  /** Bucket start, YYYY-MM-DD (UTC) */
  date: string
  /** Meilisearch filter for that day */
  filter: string[]
}

/**
 * One count query per day in [since, until), for a single Meilisearch
 * `multiSearch`. `until` is exclusive.
 */
export function dayCountQueries(since: string, until: string, services: string[]): DayCountQuery[] {
  const end = new Date(`${until}T00:00:00.000Z`).getTime()
  let start = new Date(`${since}T00:00:00.000Z`).getTime()

  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return []
  }

  const queries: DayCountQuery[] = []
  while (start < end) {
    const date = dayKey(new Date(start))
    const next = dayKey(new Date(start + DAY_MS))
    queries.push({
      date,
      filter: buildMailFilter({ services, search: { since: date, before: next } })
    })
    start += DAY_MS
  }

  return queries
}

/** Meilisearch filter for a mail query; all parts are combined with AND */
export function buildMailFilter({ services, mailbox, participant, conversationKeys, search }: Pick<MailIndexQuery, 'services' | 'mailbox' | 'participant' | 'conversationKeys' | 'search'>): string[] {
  const filter = [`service IN [${services.map(filterValue).join(', ')}]`]

  if (mailbox) filter.push(`mailbox = ${filterValue(mailbox)}`)
  if (participant) filter.push(`participantTerms = ${filterValue(normalizeEmail(participant) ?? participant.trim().toLowerCase())}`)
  if (conversationKeys?.length) filter.push(`conversationKeys IN [${conversationKeys.map(filterValue).join(', ')}]`)
  if (search.unread) filter.push('unread = true')
  if (search.flagged) filter.push('flagged = true')
  if (search.hasAttachment) filter.push('hasAttachment = true')
  if (search.since) filter.push(`date >= ${unixSeconds(search.since)}`)
  if (search.before) filter.push(`date < ${unixSeconds(search.before)}`)
  if (search.from) filter.push(`fromTerms = ${filterValue(normalizeSenderTerm(search.from))}`)

  return filter
}
