import type { MailDocument } from './document'
import { labelFromMailbox } from '../../shared/mail-labels'

/** What the label helpers need of a document */
type LabelledDocument = Pick<MailDocument, 'mailbox'>

/**
 * The label names a message is filed under: the `Labels/<name>` folders its
 * copies sit in. Derived from the folder path rather than a stored list, so a
 * removed copy cannot leave its label behind.
 */
export function labelsOfDocuments(documents: LabelledDocument[]): string[] {
  const labels = new Set<string>()

  for (const document of documents) {
    const label = labelFromMailbox(document.mailbox)
    if (label) {
      labels.add(label)
    }
  }

  return [...labels]
}

/** The labels of every message, keyed by `messageId`, from its documents */
export function labelsByMessageId(documents: Pick<MailDocument, 'mailbox' | 'messageId'>[]): Map<string, string[]> {
  const byMessage = new Map<string, LabelledDocument[]>()

  for (const document of documents) {
    const list = byMessage.get(document.messageId)
    if (list) {
      list.push(document)
    } else {
      byMessage.set(document.messageId, [document])
    }
  }

  return new Map([...byMessage].map(([messageId, list]) => [messageId, labelsOfDocuments(list)]))
}
