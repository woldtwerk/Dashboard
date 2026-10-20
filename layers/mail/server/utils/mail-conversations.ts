import type { MailConversation, MailSummary } from '../../shared/types/mail'
import { groupConversations } from '../../shared/mail-thread'

/** Mails one index query fetches while filling a page of conversations */
export const CONVERSATION_FETCH_CHUNK = 500

/**
 * How many mails one conversations request may scan. Each round regroups the
 * accumulated mails, so the loop needs a hard bound rather than running until
 * the index is exhausted.
 */
export const CONVERSATION_SCAN_MAX = 20_000

export type ConversationChunkFetcher = (offset: number, size: number) => Promise<MailSummary[]>

export interface ConversationPagingOptions {
  chunkSize?: number
  maxMails?: number
}

/**
 * Fills one page of conversations from newest-first index chunks. A conversation
 * is only complete once all its mails are scanned, and the page may lie deep in
 * the grouped result, so the source is fetched in chunks until grouping holds
 * more than `offset + limit` conversations or the index is exhausted.
 */
export async function loadConversationPage(
  fetchChunk: ConversationChunkFetcher,
  offset: number,
  limit: number,
  options: ConversationPagingOptions = {}
): Promise<MailConversation[]> {
  const chunkSize = options.chunkSize ?? CONVERSATION_FETCH_CHUNK
  const maxMails = options.maxMails ?? CONVERSATION_SCAN_MAX
  const wanted = offset + limit
  const mails: MailSummary[] = []
  let conversations = groupConversations(mails)

  while (mails.length < maxMails) {
    const size = Math.min(chunkSize, maxMails - mails.length)
    const chunk = await fetchChunk(mails.length, size)
    mails.push(...chunk.slice(0, size))
    conversations = groupConversations(mails)

    // A full page alone does not prove there is more; a further conversation does
    if (conversations.length > wanted || chunk.length < size) {
      break
    }
  }

  return conversations.slice(offset, wanted).map(({ key, subject, participants, count, unread, latest }) => ({
    key,
    subject,
    participants,
    count,
    unread,
    latest
  }))
}
