import { format, subDays } from 'date-fns'
import type { MailSearch, MailSummary } from '#layers/mail/shared/types/mail'

/** URL query of the mail page; every key is optional */
export type MailQuery = Record<string, string | null | undefined | (string | null)[]>

/** Messages fetched per loaded page; "load more" adds a page */
export const MAIL_PAGE_SIZE = 50

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const stringParam = (query: MailQuery, key: string) => {
  const value = query[key]
  return typeof value === 'string' && value ? value : undefined
}

const numberParam = (query: MailQuery, key: string, fallback: number) => {
  const value = Number(stringParam(query, key))
  return Number.isInteger(value) && value >= 0 ? value : fallback
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
    hasAttachment: stringParam(query, 'attachment') === 'true' || undefined,
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
    attachment: search.hasAttachment ? 'true' : null,
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
    hasAttachment: search.hasAttachment ? 'true' : undefined,
    since: search.since,
    before: search.before
  }
}

/** How the list is scoped and paged; kept in the URL as well */
export interface MailListQuery {
  /** Search across all folders of the account instead of one mailbox */
  allFolders: boolean
  /** Loaded pages; the list always fetches from the start (`pages * MAIL_PAGE_SIZE`) */
  pages: number
}

export function mailListFromQuery(query: MailQuery): MailListQuery {
  return {
    allFolders: stringParam(query, 'scope') === 'all',
    pages: Math.max(1, numberParam(query, 'pages', 1))
  }
}

export function mailListToQuery(list: MailListQuery): Record<string, string | null> {
  return {
    scope: list.allFolders ? 'all' : null,
    pages: list.pages > 1 ? String(list.pages) : null
  }
}

/** The open mail; a UID is only unique within its mailbox */
export interface MailSelection {
  uid: number
  mailbox: string
}

/** The open mail from the URL; `in` names the mailbox when it is not the current folder */
export function mailSelectionFromQuery(query: MailQuery, mailbox: string): MailSelection | undefined {
  const uid = Number(stringParam(query, 'uid'))
  if (!Number.isInteger(uid) || uid <= 0) {
    return undefined
  }

  return { uid, mailbox: stringParam(query, 'in') ?? mailbox }
}

/** URL patch for the open mail; keeps `in` only when it differs from the current folder */
export function mailSelectionToQuery(selection: MailSelection | null, mailbox: string): Record<string, string | null> {
  return {
    uid: selection ? String(selection.uid) : null,
    in: selection && selection.mailbox !== mailbox ? selection.mailbox : null
  }
}

/** Whether a list hit is the open mail; uids repeat across folders, so the mailbox must match too */
export function isSelectedMail(mail: MailSummary, selection?: MailSelection): boolean {
  return !!selection && mail.uid === selection.uid && mail.mailbox === selection.mailbox
}
