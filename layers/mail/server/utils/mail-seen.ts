import { mailDocumentId } from '../mail-index/document'
import type { MailProvider } from './mail-provider'
import type { MailSearchIndex } from './mail-search-index'

/** Just the logger the seen update needs; matches the consola instance used across the server */
interface MailSeenLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void
}

/** Injected so the provider → index → event sequence is testable without Nuxt */
export interface MailSeenDependencies {
  provider: Pick<MailProvider, 'setSeenMany'>
  /** Absent without a search index; then the provider alone carries the flag */
  index?: Pick<MailSearchIndex, 'updateFlags'>
  /** Announces the change to the domain event stream */
  publish: () => Promise<void>
  logger: MailSeenLogger
}

/**
 * Applies a seen flag to several messages of one mailbox, then to the search
 * index, and finally announces the change. The index is updated here because the
 * provider does not touch it: without this the next list request still returns
 * the mails as unread until the background sync corrects it. An index failure is
 * logged and left to that sync, so it never fails the request.
 */
export async function setMailSeenMany(
  service: string,
  mailbox: string,
  uids: number[],
  seen: boolean,
  deps: MailSeenDependencies
): Promise<void> {
  if (uids.length) {
    await deps.provider.setSeenMany(mailbox, uids, seen)
  }

  if (deps.index && uids.length) {
    try {
      await deps.index.updateFlags(uids.map(uid => ({ id: mailDocumentId(service, mailbox, uid), unread: !seen })))
    } catch (error) {
      deps.logger.warn('Could not update the mail search index', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  await deps.publish()
}

/**
 * Applies a seen flag to one message; the same provider → index → event sequence
 * as the batch form, so both paths cannot drift apart.
 */
export async function setMailSeen(
  service: string,
  mailbox: string,
  uid: number,
  seen: boolean,
  deps: MailSeenDependencies
): Promise<void> {
  await setMailSeenMany(service, mailbox, [uid], seen, deps)
}
