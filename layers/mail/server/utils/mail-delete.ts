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
  provider: Pick<MailProvider, 'moveMessage'>
  /** Absent without a search index; then the next sync corrects the index */
  index?: Pick<MailSearchIndex, 'remove'>
  /** Announces a change of one mailbox to the domain event stream */
  publish: (mailbox: string) => Promise<void>
  logger: MailDeleteLogger
}

export interface MailDeleteDependencies extends MailMoveDependencies {
  /** Needed to resolve the account's trash folder */
  provider: Pick<MailProvider, 'listMailboxes' | 'moveMessage' | 'deleteMessage'>
}

/** What the delete did: moved to the trash, or removed for good */
export type MailDeleteOutcome
  = | { action: 'trashed', trashMailbox: string, trashUid?: number }
    | { action: 'deleted' }

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
 * Drops one message from the search index right away. The provider does not touch
 * the index, so without this the deleted mail lingers in search results until the
 * background sync notices it. Move indexes it again in the target folder. A
 * failure is logged and left to that sync, so it never fails the request.
 */
async function removeFromIndex(service: string, mailbox: string, uid: number, deps: MailMoveDependencies): Promise<void> {
  if (!deps.index) {
    return
  }

  try {
    await deps.index.remove([mailDocumentId(service, mailbox, uid)])
  } catch (error) {
    deps.logger.warn('Could not update the mail search index', { error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Moves one message to another mailbox, then removes its old document from the
 * index and announces both mailboxes. Returns the message's new UID, when the
 * server exposes one (IMAP UIDPLUS).
 */
export async function moveMail(
  service: string,
  mailbox: string,
  uid: number,
  target: string,
  deps: MailMoveDependencies
): Promise<{ uid?: number }> {
  const { uid: newUid } = await deps.provider.moveMessage(mailbox, uid, target)

  await removeFromIndex(service, mailbox, uid, deps)
  await deps.publish(mailbox)
  await deps.publish(target)

  return { uid: newUid }
}

/**
 * Deletes one message. Outside the trash it moves to the account's trash folder —
 * undoable; with `options.permanent` and no trash to move to (the mail is already
 * in the trash, or the account has none) it expunges the message for good. A
 * permanent delete the caller did not ask for is refused with a 409, so a caller
 * that does not know about the trash can never destroy mail by accident. Either
 * way the old index document goes and the affected mailbox(es) are announced.
 */
export async function deleteMail(
  service: string,
  mailbox: string,
  uid: number,
  options: MailDeleteOptions,
  deps: MailDeleteDependencies
): Promise<MailDeleteOutcome> {
  const trash = trashTarget(await deps.provider.listMailboxes(), mailbox)

  if (trash) {
    const { uid: trashUid } = await deps.provider.moveMessage(mailbox, uid, trash.path)

    await removeFromIndex(service, mailbox, uid, deps)
    await deps.publish(mailbox)
    await deps.publish(trash.path)

    return { action: 'trashed', trashMailbox: trash.path, trashUid }
  }

  // No target: the mail is in the trash already, or the account has none. Both
  // destroy it, so they need the caller's explicit confirmation.
  if (options.permanent !== true) {
    throw createError({ status: 409, statusText: 'Deleting permanently needs confirmation' })
  }

  await deps.provider.deleteMessage(mailbox, uid)
  await removeFromIndex(service, mailbox, uid, deps)
  await deps.publish(mailbox)

  return { action: 'deleted' }
}
