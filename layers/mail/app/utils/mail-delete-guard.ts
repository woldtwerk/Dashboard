import type { MailSummary } from '#layers/mail/shared/types/mail'
import { mailKey } from './mail'

/** How long a deleted mail stays hidden from a reloaded list */
export const MAIL_DELETE_HOLD_MS = 15_000

/** A mail deleted on this page, kept out of the lists that still carry it */
export interface RecentlyDeletedEntry {
  /** `mailKey` of the mail when it was deleted */
  key: string
  /** Message-ID, so the mail is still recognised when it returns under another uid */
  messageId?: string
  /** When the delete started, in ms */
  at: number
}

/** Recently deleted mails, by `mailKey` */
export type RecentlyDeleted = Map<string, RecentlyDeletedEntry>

/** Keep a deleted mail out of a reloaded list; a newer delete overwrites an older one */
export function holdDeleted(state: RecentlyDeleted, mail: MailSummary, now = Date.now()): void {
  const key = mailKey(mail)
  state.set(key, { key, messageId: mail.messageId, at: now })
}

/** Forget a deleted mail again, e.g. when its delete failed or an undo restored it; an unknown key is ignored */
export function releaseDeleted(state: RecentlyDeleted, key: string): void {
  state.delete(key)
}

/** Drop every entry whose hold has passed */
export function expireDeleted(state: RecentlyDeleted, now = Date.now()): void {
  for (const [key, entry] of [...state]) {
    if (entry.at + MAIL_DELETE_HOLD_MS <= now) {
      state.delete(key)
    }
  }
}

/** Whether a list entry is a mail this page deleted moments ago */
function isHeldDeleted(mail: MailSummary, state: RecentlyDeleted): boolean {
  if (state.has(mailKey(mail))) {
    return true
  }
  if (!mail.messageId) {
    return false
  }
  for (const entry of state.values()) {
    if (entry.messageId && entry.messageId === mail.messageId) {
      return true
    }
  }
  return false
}

/**
 * The fetched list without the mails this page deleted moments ago. A reload can
 * start before a slow delete finished and return a snapshot that still has the
 * mail; this keeps it out until the hold has passed. The same array is returned
 * when nothing was dropped.
 */
export function withoutDeleted(list: MailSummary[], state: RecentlyDeleted, now = Date.now()): MailSummary[] {
  expireDeleted(state, now)
  if (!state.size) {
    return list
  }

  const kept = list.filter(mail => !isHeldDeleted(mail, state))
  return kept.length === list.length ? list : kept
}
