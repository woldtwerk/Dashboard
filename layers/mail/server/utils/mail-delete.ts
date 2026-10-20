import { createError } from 'nuxt/server'
import { mailDocumentId } from '../mail-index/document'
import { trashTarget } from '../../shared/mail-delete'
import type { MailProvider } from './mail-provider'
import type { MailSearchIndex } from './mail-search-index'

/** Just the logger the delete and move need; matches the consola instance used across the server */
interface MailDeleteLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void
}

/** Injected so the provider → index → event sequence is testable without Nuxt */
export interface MailMoveDependencies {
  provider: Pick<MailProvider, 'moveMessages'>
  /** Absent without a search index; then the next sync corrects the index */
  index?: Pick<MailSearchIndex, 'remove'>
  /** Announces a change of one mailbox to the domain event stream */
  publish: (mailbox: string) => Promise<void>
  logger: MailDeleteLogger
}

export interface MailDeleteDependencies extends MailMoveDependencies {
  /** Needed to resolve the account's trash folder */
  provider: Pick<MailProvider, 'listMailboxes' | 'moveMessages' | 'deleteMessages'>
}

/** What the delete did: moved to the trash, or removed for good */
export type MailDeleteOutcome
  = | { action: 'trashed', trashMailbox: string, trashUid?: number }
    | { action: 'deleted' }

/** One mail of a batch delete: its own uid and, after a move, its uid in the trash */
export interface MailDeleteItem {
  uid: number
  trashUid?: number
}

/** What a batch delete did; `items` is in the order the uids were given */
export type MailDeleteBatchOutcome
  = | { action: 'trashed', trashMailbox: string, items: MailDeleteItem[] }
    | { action: 'deleted', items: { uid: number }[] }

/** One mail of a batch move: its old uid and, where reported, its uid in the target */
export interface MailMoveItem {
  uid: number
  newUid?: number
}

/** How the caller wants the delete carried out */
export interface MailDeleteOptions {
  /**
   * Accepts a permanent (unrecoverable) delete. Only needed when there is no
   * trash to move the mail to — the mail already sits in the trash, or the
   * account has none. Without it those cases are refused with a 409 instead of
   * destroying the mail.
   */
  permanent?: boolean
}

/**
 * Drops several messages from the search index right away. The provider does not
 * touch the index, so without this the deleted mails linger in search results
 * until the background sync notices them. A failure is logged and left to that
 * sync, so it never fails the request.
 */
async function removeFromIndex(service: string, mailbox: string, uids: number[], deps: MailMoveDependencies): Promise<void> {
  if (!deps.index || !uids.length) {
    return
  }

  try {
    await deps.index.remove(uids.map(uid => mailDocumentId(service, mailbox, uid)))
  } catch (error) {
    deps.logger.warn('Could not update the mail search index', { error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Moves several messages of one mailbox to another mailbox, then removes their
 * old documents from the index and announces both mailboxes. Returns each old
 * uid with its new uid where the server reports one (IMAP UIDPLUS).
 */
export async function moveMailMany(
  service: string,
  mailbox: string,
  uids: number[],
  target: string,
  deps: MailMoveDependencies
): Promise<{ items: MailMoveItem[] }> {
  const mapping = await deps.provider.moveMessages(mailbox, uids, target)
  const items = uids.map(uid => ({ uid, newUid: mapping.get(uid) }))

  await removeFromIndex(service, mailbox, uids, deps)
  await deps.publish(mailbox)
  await deps.publish(target)

  return { items }
}

/**
 * Moves one message to another mailbox; the batch form with a single uid, so
 * both paths cannot drift apart.
 */
export async function moveMail(
  service: string,
  mailbox: string,
  uid: number,
  target: string,
  deps: MailMoveDependencies
): Promise<{ uid?: number }> {
  const { items } = await moveMailMany(service, mailbox, [uid], target, deps)
  return { uid: items[0]?.newUid }
}

/**
 * Deletes several messages of one mailbox. Outside the trash they are moved to
 * the account's trash folder — undoable; with `options.permanent` and no trash
 * to move to (the mails are already in the trash, or the account has none) they
 * are expunged for good. A permanent delete the caller did not ask for is
 * refused with a 409 before anything is touched, so a caller that does not know
 * about the trash can never destroy mail by accident. Either way the old index
 * documents go and the affected mailbox(es) are announced once.
 */
export async function deleteMailMany(
  service: string,
  mailbox: string,
  uids: number[],
  options: MailDeleteOptions,
  deps: MailDeleteDependencies
): Promise<MailDeleteBatchOutcome> {
  const trash = trashTarget(await deps.provider.listMailboxes(), mailbox)

  if (trash) {
    const mapping = await deps.provider.moveMessages(mailbox, uids, trash.path)
    const items = uids.map(uid => ({ uid, trashUid: mapping.get(uid) }))

    await removeFromIndex(service, mailbox, uids, deps)
    await deps.publish(mailbox)
    await deps.publish(trash.path)

    return { action: 'trashed', trashMailbox: trash.path, items }
  }

  // No target: the mails are in the trash already, or the account has none. Both
  // destroy them, so they need the caller's explicit confirmation.
  if (options.permanent !== true) {
    throw createError({ status: 409, statusText: 'Deleting permanently needs confirmation' })
  }

  await deps.provider.deleteMessages(mailbox, uids)

  await removeFromIndex(service, mailbox, uids, deps)
  await deps.publish(mailbox)

  return { action: 'deleted', items: uids.map(uid => ({ uid })) }
}

/**
 * Deletes one message; the batch form with a single uid, so both paths cannot
 * drift apart.
 */
export async function deleteMail(
  service: string,
  mailbox: string,
  uid: number,
  options: MailDeleteOptions,
  deps: MailDeleteDependencies
): Promise<MailDeleteOutcome> {
  const outcome = await deleteMailMany(service, mailbox, [uid], options, deps)

  return outcome.action === 'trashed'
    ? { action: 'trashed', trashMailbox: outcome.trashMailbox, trashUid: outcome.items[0]?.trashUid }
    : { action: 'deleted' }
}
