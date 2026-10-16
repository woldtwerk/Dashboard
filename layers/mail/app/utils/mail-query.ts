import { format, subDays } from 'date-fns'
import type { MailSearch } from '#layers/mail/shared/types/mail'

/** URL query of the mail page; every key is optional */
export type MailQuery = Record<string, string | null | undefined | (string | null)[]>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const stringParam = (query: MailQuery, key: string) => {
  const value = query[key]
  return typeof value === 'string' && value ? value : undefined
}

/** Search criteria from the URL; `days` is a relative period, `since` an absolute date and wins */
export function mailSearchFromQuery(query: MailQuery, today = new Date()): MailSearch {
  const days = Number(stringParam(query, 'days')) || undefined
  const date = (key: string) => {
    const value = stringParam(query, key)
    return value && ISO_DATE.test(value) ? value : undefined
  }

  return {
    text: stringParam(query, 'q'),
    unread: stringParam(query, 'unread') === 'true' || undefined,
    flagged: stringParam(query, 'flagged') === 'true' || undefined,
    from: stringParam(query, 'from'),
    since: date('since') ?? (days ? format(subDays(today, days), 'yyyy-MM-dd') : undefined),
    before: date('before')
  }
}

/** URL patch that replaces all search criteria (null removes a key) */
export function mailSearchToQuery(search: MailSearch): Record<string, string | null> {
  return {
    q: search.text?.trim() || null,
    unread: search.unread ? 'true' : null,
    flagged: search.flagged ? 'true' : null,
    from: search.from?.trim() || null,
    since: search.since || null,
    before: search.before || null,
    days: null
  }
}

/** Query for the messages API */
export function mailSearchToApiQuery(search: MailSearch): Record<string, string | undefined> {
  return {
    q: search.text,
    unread: search.unread ? 'true' : undefined,
    flagged: search.flagged ? 'true' : undefined,
    from: search.from,
    since: search.since,
    before: search.before
  }
}
