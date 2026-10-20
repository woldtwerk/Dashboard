import type { MailConversation, MailSummary } from '#layers/mail/shared/types/mail'
import type { RetainedMail, RetainedMails } from './mail-retention'
import { mailKey } from './mail'

/** The bulk actions the list and the context menu offer for several mails */
export type MailBatchAction = 'read' | 'unread' | 'delete'

/** One batch request handles at most this many uids of one mailbox */
export const MAIL_BATCH_MAX = 200

/** The uids of one mailbox a batch request carries */
export interface MailBatchGroup {
  mailbox: string
  uids: number[]
}

/**
 * The API calls a batch action needs: mails grouped by mailbox, in selection
 * order, split so one request never carries more than {@link MAIL_BATCH_MAX}
 * uids. A uid is only unique within its mailbox, so the grouping is required.
 */
export function mailBatchGroups(mails: MailSummary[]): MailBatchGroup[] {
  const byMailbox = new Map<string, number[]>()
  const seen = new Set<string>()

  for (const mail of mails) {
    const key = mailKey(mail)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    const uids = byMailbox.get(mail.mailbox)
    if (uids) {
      uids.push(mail.uid)
    } else {
      byMailbox.set(mail.mailbox, [mail.uid])
    }
  }

  const groups: MailBatchGroup[] = []
  for (const [mailbox, uids] of byMailbox) {
    for (let start = 0; start < uids.length; start += MAIL_BATCH_MAX) {
      groups.push({ mailbox, uids: uids.slice(start, start + MAIL_BATCH_MAX) })
    }
  }

  return groups
}

/** One mail of a batch delete: its own uid and, after a move, its uid in the trash */
export interface MailDeleteBatchItem {
  uid: number
  trashUid?: number
}

/** What the batch delete endpoint answered */
export type MailDeleteBatchResult
  = | { action: 'trashed', trashMailbox: string, items: MailDeleteBatchItem[] }
    | { action: 'deleted', items: { uid: number }[] }

/** What the batch move endpoint answered */
export interface MailMoveBatchResult {
  items: { uid: number, newUid?: number }[]
}

/** Where a deleted mail sat before it left the list, and what else held it */
export interface MailDeleteUndoEntry {
  mail: MailSummary
  /** Its place in the loaded list; -1 when it was not in it, e.g. a linked mail */
  listIndex: number
  /** The unread-retention entry it had, if any */
  retained?: RetainedMail
  /** Its place among the conversations, for the single-mail conversation it emptied */
  conversationIndex: number
  conversation?: MailConversation
}

/** What an optimistic delete took away, so a failure or an undo can put it back */
export interface MailDeleteUndo {
  entries: MailDeleteUndoEntry[]
}

/** The pieces of the page an optimistic delete changes */
export interface MailListState {
  list: MailSummary[]
  retained: RetainedMails
  conversations: MailConversation[]
}

/**
 * Removes the mails from the loaded list, the unread-retention state and the
 * single-mail conversations they emptied, and records where they were. The
 * returned state is new; the given maps and arrays are left untouched.
 */
export function applyMailDelete(state: MailListState, deleting: MailSummary[]): MailListState & { undo: MailDeleteUndo } {
  const keys = new Set(deleting.map(mailKey))

  const entries: MailDeleteUndoEntry[] = deleting.map((mail) => {
    const key = mailKey(mail)
    const conversationIndex = state.conversations.findIndex(item => item.count === 1 && mailKey(item.latest) === key)

    return {
      mail,
      listIndex: state.list.findIndex(item => mailKey(item) === key),
      retained: state.retained.get(key),
      conversationIndex,
      conversation: conversationIndex >= 0 ? state.conversations[conversationIndex] : undefined
    }
  })

  // Ascending indices let the restore splice every mail back into its old place
  entries.sort((left, right) => left.listIndex - right.listIndex)

  const retained = new Map(state.retained)
  for (const key of keys) {
    retained.delete(key)
  }

  const conversationKeys = new Set(entries.filter(entry => entry.conversation).map(entry => entry.conversation!.key))

  return {
    list: state.list.filter(item => !keys.has(mailKey(item))),
    retained,
    conversations: state.conversations.filter(item => !conversationKeys.has(item.key)),
    undo: { entries }
  }
}

/**
 * Puts back what an optimistic delete removed: the list entries at their old
 * indices, their retention and their conversations. `replace` exchanges a mail
 * for its new form, e.g. the uid it got when it was moved out of the trash.
 */
export function restoreMailDelete(
  state: MailListState,
  undo: MailDeleteUndo,
  replace: (mail: MailSummary) => MailSummary = mail => mail
): MailListState {
  let list = [...state.list]
  const retained = new Map(state.retained)

  for (const entry of [...undo.entries].sort((left, right) => left.listIndex - right.listIndex)) {
    const mail = replace(entry.mail)

    if (entry.listIndex >= 0 && !list.some(item => mailKey(item) === mailKey(mail))) {
      const next = [...list]
      next.splice(Math.min(entry.listIndex, next.length), 0, mail)
      list = next
    }

    if (entry.retained && !retained.has(mailKey(mail))) {
      retained.set(mailKey(mail), { ...entry.retained, mail })
    }
  }

  let conversations = [...state.conversations]
  for (const entry of [...undo.entries].sort((left, right) => left.conversationIndex - right.conversationIndex)) {
    if (entry.conversation && !conversations.some(item => item.key === entry.conversation!.key)) {
      const next = [...conversations]
      next.splice(Math.min(entry.conversationIndex, next.length), 0, entry.conversation)
      conversations = next
    }
  }

  return { list, retained, conversations }
}
