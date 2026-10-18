import { mailDocumentId } from '../mail-index/document'
import type { MailProvider } from './mail-provider'
import type { MailSearchIndex } from './mail-search-index'

/** Just the logger the seen update needs; matches the consola instance used across the server */
interface MailSeenLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void
}

/** Injected so the provider → index → event sequence is testable without Nuxt */
export interface MailSeenDependencies {
  provider: Pick<MailProvider, 'setSeen'>
  /** Absent without a search index; then the provider alone carries the flag */
  index?: Pick<MailSearchIndex, 'updateFlags'>
  /** Announces the change to the domain event stream */
  publish: () => Promise<void>
  logger: MailSeenLogger
}

/**
 * Applies a seen flag to the provider, then to the search index, and finally
 * announces the change. The index is updated here because the provider does not
 * touch it: without this the next list request still returns the mail as unread
 * until the background sync corrects it. An index failure is logged and left to
 * that sync, so it never fails the request.
 */
export async function setMailSeen(
  service: string,
  mailbox: string,
  uid: number,
  seen: boolean,
  deps: MailSeenDependencies
): Promise<void> {
  await deps.provider.setSeen(mailbox, uid, seen)

  if (deps.index) {
    try {
      await deps.index.updateFlags([{ id: mailDocumentId(service, mailbox, uid), unread: !seen }])
    } catch (error) {
      deps.logger.warn('Could not update the mail search index', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  await deps.publish()
}
