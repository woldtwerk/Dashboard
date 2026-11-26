import type { MailConversation, MailSearch, MailSummary } from '#layers/mail/shared/types/mail'
import { hasLabel } from './mail-labels'
import { mailKey } from './mail'

/** Mails the unread filter would drop but that stay in the list, shown as read, by `mailKey` */
export type RetainedMails = Map<string, MailSummary>

/** Conversations the unread filter would drop but that stay in the list, shown as read, by key */
export type RetainedConversations = Map<string, MailConversation>

/** Keep a mail in the unread list, shown as read, for as long as that list lives */
export function retain(state: RetainedMails, mail: MailSummary): void {
  state.set(mailKey(mail), { ...mail, unread: false })
}

/** Keep a conversation in the unread list, shown as read, for as long as that list lives */
export function retainConversation(state: RetainedConversations, conversation: MailConversation): void {
  state.set(conversation.key, { ...conversation, unread: false, latest: { ...conversation.latest, unread: false } })
}

/** Whether a summary still matches the filters a mail can answer on the client */
function matchesSearch(mail: MailSummary, filter: MailSearch): boolean {
  if (filter.flagged && !mail.flagged) {
    return false
  }
  if (filter.hasAttachment && mail.hasAttachment === false) {
    return false
  }
  if (filter.label && !hasLabel(mail, filter.label)) {
    return false
  }
  if (filter.notLabel && hasLabel(mail, filter.notLabel)) {
    return false
  }
  return true
}

/**
 * The retention state after a seen change. A mail that is in the loaded list, or
 * that is kept although the unread filter dropped it, stays at its new state, so
 * reading or marking it unread does not move the list. A mail that was never in
 * the list, e.g. one opened from another folder by link, is not added.
 */
export function retainedAfterSeen(
  state: RetainedMails,
  targets: MailSummary[],
  displayed: MailSummary[],
  seen: boolean
): RetainedMails {
  const next = new Map(state)
  const present = new Map(displayed.map(mail => [mailKey(mail), mail]))

  for (const target of targets) {
    const key = mailKey(target)
    const held = state.get(key)
    const mail = present.get(key) ?? held ?? target

    if (seen) {
      if (present.has(key) || held) {
        retain(next, mail)
      }
      continue
    }

    // Marked unread again: a row the list dropped stays, now unread
    if (held && !present.has(key)) {
      next.set(key, { ...mail, unread: true })
    } else {
      next.delete(key)
    }
  }

  return next
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
 * The fetched list plus the retained mails the unread filter dropped, at their
 * date's position, until the list changes. The retained copy itself is shown —
 * it can be unread again after a mark-unread. Missing entries are spliced only
 * when they still match the filters a summary can answer on the client; the
 * rest stay the server's business. Without the unread filter the fetched list
 * is returned unchanged.
 */
export function visibleMails(fetched: MailSummary[], state: RetainedMails, filter: MailSearch): MailSummary[] {
  if (!filter.unread) {
    return fetched
  }

  // A retained key uses its own copy, even when an optimistic update still has it in the list
  const base = fetched
    .filter(mail => mail.unread || state.has(mailKey(mail)))
    .map(mail => state.get(mailKey(mail)) ?? mail)

  if (!state.size) {
    return base
  }

  const present = new Set(base.map(mailKey))
  const missing = [...state.values()]
    .filter(mail => !present.has(mailKey(mail)) && matchesSearch(mail, filter))

  return insertByDate(base, missing, mail => mail.date)
}

/**
 * The conversations counterpart of `visibleMails`, keyed by conversation key and
 * ordered by the latest mail's date. A thread that got new unread mail after it
 * was retained is shown unread again: the fresh state wins over the held copy.
 */
export function visibleConversations(fetched: MailConversation[], state: RetainedConversations, filter: MailSearch): MailConversation[] {
  if (!filter.unread) {
    return fetched
  }

  const base = fetched
    .filter(conversation => conversation.unread || state.has(conversation.key))
    .map((conversation) => {
      const held = state.get(conversation.key)
      if (!held) {
        return conversation
      }
      // New unread mail in a thread read earlier: the fresh state wins over the held copy
      const revived = conversation.unread
        && (held.latest.uid !== conversation.latest.uid || held.latest.date !== conversation.latest.date)
      return revived ? conversation : held
    })

  if (!state.size) {
    return base
  }

  const present = new Set(base.map(conversation => conversation.key))
  const missing = [...state.values()]
    .filter(conversation => !present.has(conversation.key) && matchesSearch(conversation.latest, filter))

  return insertByDate(base, missing, conversation => conversation.latest.date)
}
