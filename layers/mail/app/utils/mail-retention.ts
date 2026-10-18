import type { MailConversation, MailSearch, MailSummary } from '#layers/mail/shared/types/mail'
import { mailKey } from './mail'

/** How long a released mail or conversation stays before it goes, in ms */
export const MAIL_RETENTION_MS = 3000

/** A mail kept visible although the filter would drop it; `until: null` keeps it while it is selected */
export interface RetainedMail {
  mail: MailSummary
  until: number | null
}

/** Mails kept in the list, by `mailKey` */
export type RetainedMails = Map<string, RetainedMail>

/** A conversation kept visible although the filter would drop it; `until: null` keeps it while it is open */
export interface RetainedConversation {
  conversation: MailConversation
  until: number | null
}

/** Conversations kept in the list, by conversation key */
export type RetainedConversations = Map<string, RetainedConversation>

interface Expirable {
  until: number | null
}

/** Keep a mail, shown as read, until further notice */
export function retain(state: RetainedMails, mail: MailSummary): void {
  state.set(mailKey(mail), { mail: { ...mail, unread: false }, until: null })
}

/** Keep a conversation, shown as read, until further notice */
export function retainConversation(state: RetainedConversations, conversation: MailConversation): void {
  state.set(conversation.key, { conversation: { ...conversation, unread: false }, until: null })
}

/** Let a retained item go `delayMs` from `now`; an unknown key is ignored */
export function release<T extends Expirable>(state: Map<string, T>, key: string, now: number, delayMs = MAIL_RETENTION_MS): void {
  const entry = state.get(key)
  if (entry) {
    entry.until = now + delayMs
  }
}

/** Drop every item whose deadline has passed; one without a deadline stays */
export function expire<T extends Expirable>(state: Map<string, T>, now: number): void {
  for (const [key, entry] of [...state]) {
    if (entry.until !== null && entry.until <= now) {
      state.delete(key)
    }
  }
}

/** Splice the missing items into a list sorted newest first, at their date's position */
function insertByDate<T>(base: T[], missing: T[], dateOf: (item: T) => string): T[] {
  if (!missing.length) {
    return base
  }

  const result = [...base]
  for (const item of missing) {
    const at = result.findIndex(entry => Date.parse(dateOf(entry)) < Date.parse(dateOf(item)))
    if (at === -1) {
      result.push(item)
    } else {
      result.splice(at, 0, item)
    }
  }
  return result
}

/**
 * The fetched list plus the retained mails the filter would drop, inserted where
 * their date belongs, so an opened mail does not jump or vanish. Under the unread
 * filter a fetched mail belongs only while it is still unread or while it is
 * retained; without the filter the list is returned unchanged.
 */
export function visibleMails(fetched: MailSummary[], state: RetainedMails, filter: MailSearch): MailSummary[] {
  if (!filter.unread) {
    return fetched
  }

  // A retained key is shown as read, even when an optimistic update still has it in the list
  const base = fetched
    .filter(mail => mail.unread || state.has(mailKey(mail)))
    .map(mail => state.has(mailKey(mail)) ? { ...mail, unread: false } : mail)

  if (!state.size) {
    return base
  }

  const present = new Set(base.map(mailKey))
  const missing = [...state.values()].map(entry => entry.mail).filter(mail => !present.has(mailKey(mail)))

  return insertByDate(base, missing, mail => mail.date)
}

/**
 * The conversations counterpart of `visibleMails`, keyed by conversation key and
 * ordered by the latest mail's date.
 */
export function visibleConversations(fetched: MailConversation[], state: RetainedConversations, filter: MailSearch): MailConversation[] {
  if (!filter.unread) {
    return fetched
  }

  const base = fetched
    .filter(conversation => conversation.unread || state.has(conversation.key))
    .map(conversation => state.has(conversation.key) ? { ...conversation, unread: false } : conversation)

  if (!state.size) {
    return base
  }

  const present = new Set(base.map(conversation => conversation.key))
  const missing = [...state.values()].map(entry => entry.conversation).filter(conversation => !present.has(conversation.key))

  return insertByDate(base, missing, conversation => conversation.latest.date)
}
