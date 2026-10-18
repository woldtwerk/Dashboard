import { mailDocumentId } from '../mail-index/document'
import { streamConversationKey, mergeStreamKeys } from '../../shared/mail-thread'
import type { MailDocumentUpdate, MailSearchIndex } from './mail-search-index'
import type { MailProvider } from './mail-provider'

/** UIDs one header fetch covers; the sync lock is renewed between them */
export const STREAM_HEADER_BATCH = 500

/** Documents read back from the index per page, to know their stored keys */
const INDEX_PAGE = 1000

export interface StreamBackfillDeps {
  service: string
  mailbox: string
  /** The mailbox's indexed UIDs; only their headers are fetched */
  uids: number[]
  provider: Pick<MailProvider, 'getStreamHeaders'>
  index: Pick<MailSearchIndex, 'search' | 'updateDocuments'>
  /** Called before each header batch; `false` stops the run so it resumes later */
  renew?: () => Promise<boolean>
}

export interface StreamBackfillResult {
  /** Documents that got their stream key merged in */
  updated: number
  /** Whether every batch ran; `false` means the lock was lost mid-way */
  complete: boolean
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

/** The stored conversation keys of every document the search engine has for a mailbox */
async function loadStoredKeys(
  service: string,
  mailbox: string,
  index: Pick<MailSearchIndex, 'search'>
): Promise<Map<number, string[]>> {
  const keys = new Map<number, string[]>()

  for (let offset = 0; ; offset += INDEX_PAGE) {
    const page = await index.search({ services: [service], mailbox, search: {}, limit: INDEX_PAGE, offset })
    for (const mail of page) {
      if (mail.conversationKeys?.length) {
        keys.set(mail.uid, mail.conversationKeys)
      }
    }
    if (page.length < INDEX_PAGE) {
      break
    }
  }

  return keys
}

/**
 * Merges the stream key into every stored document of one mailbox, one header
 * batch at a time. A document whose stream key is already there is left alone,
 * so a run interrupted by a lost lock can simply start over.
 */
export async function backfillMailboxStreamKeys({ service, mailbox, uids, provider, index, renew }: StreamBackfillDeps): Promise<StreamBackfillResult> {
  if (!uids.length) {
    return { updated: 0, complete: true }
  }

  const stored = await loadStoredKeys(service, mailbox, index)
  let updated = 0

  for (const batch of chunk(uids, STREAM_HEADER_BATCH)) {
    if (renew && !await renew()) {
      return { updated, complete: false }
    }

    const headers = await provider.getStreamHeaders(mailbox, batch)
    const updates: MailDocumentUpdate[] = []

    for (const header of headers) {
      const keys = stored.get(header.uid)
      const merged = keys && mergeStreamKeys(keys, streamConversationKey(header))
      if (!merged) {
        continue
      }

      updates.push({
        id: mailDocumentId(service, mailbox, header.uid),
        conversationKeys: merged,
        listId: header.listId,
        listName: header.listName
      })
    }

    await index.updateDocuments(updates)
    updated += updates.length
  }

  return { updated, complete: true }
}
