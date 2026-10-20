import { mailDocumentId } from '../mail-index/document'
import { labelMailbox } from '../../shared/mail-labels'
import type { MailLabelRemoval, MailProvider } from './mail-provider'
import type { MailSearchIndex } from './mail-search-index'

/** Just the logger the label update needs; matches the consola instance used across the server */
interface MailLabelLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void
}

/** Injected so the provider → index → event sequence is testable without Nuxt */
export interface MailLabelDependencies {
  provider: Pick<MailProvider, 'addLabels' | 'removeLabels'>
  /** Absent without a search index; then the next sync carries the label */
  index?: Pick<MailSearchIndex, 'getDocuments' | 'documentsByMessageIds' | 'updateDocuments' | 'remove'>
  /** Announces a changed mailbox to the domain event stream */
  publish: (mailbox: string) => Promise<void>
  logger: MailLabelLogger
}

/**
 * Applies a label to several messages of one mailbox: the provider files or
 * removes the copies first, the search index then follows on every copy of the
 * same message, and both the mailbox and the label folder are announced. The
 * message stays in its folder; a label is a second place it is filed under.
 * An index failure is logged and left to the next sync, so it never fails the
 * request. Empty uids do nothing. The returned `unresolved` uids are the ones
 * whose label copy could not be found, so the caller can put their label back.
 */
export async function setMailLabelMany(
  service: string,
  mailbox: string,
  uids: number[],
  label: string,
  on: boolean,
  deps: MailLabelDependencies
): Promise<{ unresolved: number[] }> {
  if (!uids.length) {
    return { unresolved: [] }
  }

  let removal: MailLabelRemoval = { removed: [], unresolved: [] }
  if (on) {
    await deps.provider.addLabels(mailbox, uids, label)
  } else {
    removal = await deps.provider.removeLabels(mailbox, uids, label)
  }

  await updateIndexLabels(service, mailbox, uids, label, on, removal, deps)
  await deps.publish(mailbox)
  await deps.publish(labelMailbox(label))

  return { unresolved: removal.unresolved }
}

/**
 * Updates the `labels` of every indexed copy of the affected messages. The
 * source documents supply the Message-IDs, the label folder's documents are
 * dropped when the label is removed, and an add reaches copies already indexed.
 */
async function updateIndexLabels(
  service: string,
  mailbox: string,
  uids: number[],
  label: string,
  on: boolean,
  removal: MailLabelRemoval,
  deps: MailLabelDependencies
): Promise<void> {
  if (!deps.index) {
    return
  }

  try {
    // An unresolved uid has no copy to remove, so it keeps its label in the index
    // as well; the client puts it back in the list.
    const resolvedUids = on ? uids : uids.filter(uid => !removal.unresolved.includes(uid))
    const source = await deps.index.getDocuments(resolvedUids.map(uid => mailDocumentId(service, mailbox, uid)))

    if (!on) {
      const removedIds = removal.removed.map(uid => mailDocumentId(service, labelMailbox(label), uid))
      if (removedIds.length) {
        await deps.index.remove(removedIds)
      }

      // Re-read after the copies are gone, so the removed documents cannot be
      // written back; the next sync repairs a concurrent merge from another worker.
      const messageIds = [...new Set(source.map(document => document.messageId))]
      const affected = messageIds.length
        ? await deps.index.documentsByMessageIds(service, messageIds)
        : []

      await deps.index.updateDocuments(affected.map((document) => {
        const labels = new Set(document.labels ?? [])
        labels.delete(label)
        return { id: document.id, labels: [...labels] }
      }))
      return
    }

    const messageIds = [...new Set(source.map(document => document.messageId))]
    const affected = messageIds.length
      ? await deps.index.documentsByMessageIds(service, messageIds)
      : source

    const updates = affected.map((document) => {
      const labels = new Set(document.labels ?? [])
      labels.add(label)
      return { id: document.id, labels: [...labels] }
    })

    await deps.index.updateDocuments(updates)
  } catch (error) {
    deps.logger.warn('Could not update the mail search index', { error: error instanceof Error ? error.message : String(error) })
  }
}
