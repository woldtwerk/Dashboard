import { format, subDays } from 'date-fns'
import type { MailConversation, MailSearch, MailSummary } from '#layers/mail/shared/types/mail'
import { mailKey } from './mail'

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

/** Where the next page starts and whether the list is complete */
export interface MailPageState {
  /** Items already fetched; the next request starts here */
  offset: number
  /** The last page was short, so there is nothing more */
  done: boolean
}

/** The paging state after a request returned `received` of `pageSize` items */
export function nextPageState(state: MailPageState, received: number, pageSize: number): MailPageState {
  return {
    offset: state.offset + received,
    done: received < pageSize
  }
}

/** Appends items by key, dropping the ones already present; order is kept */
function mergeByKey<T>(list: T[], page: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set(list.map(keyOf))
  const merged = [...list]

  for (const item of page) {
    const key = keyOf(item)
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(item)
    }
  }

  return merged
}

/** Appends a page of mails, dropping mails already loaded; order stays newest first */
export function mergePage(list: MailSummary[], page: MailSummary[]): MailSummary[] {
  return mergeByKey(list, page, mailKey)
}

/** Appends a page of conversations, dropping groups already loaded */
export function mergeConversations(list: MailConversation[], page: MailConversation[]): MailConversation[] {
  return mergeByKey(list, page, conversation => conversation.key)
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

/** How the mail page lays out its list: single mails or grouped conversations */
export type MailView = 'mails' | 'threads'

export function mailViewFromQuery(query: MailQuery): MailView {
  return stringParam(query, 'view') === 'threads' ? 'threads' : 'mails'
}

/** URL patch for the view toggle; a conversation only exists in the conversations view */
export function mailViewToQuery(view: MailView): Record<string, string | null> {
  return { view: view === 'threads' ? 'threads' : null, conversation: null, uid: null, in: null }
}

/** The open conversation's key, from the URL */
export function mailConversationFromQuery(query: MailQuery): string | undefined {
  return stringParam(query, 'conversation')
}

/** URL patch for the open conversation; null closes it */
export function mailConversationToQuery(key: string | null): Record<string, string | null> {
  return { conversation: key, uid: null, in: null }
}
