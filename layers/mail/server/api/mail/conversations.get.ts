import { defineEventHandler, getValidatedQuery, setResponseStatus } from 'nuxt/server'
import type { MailConversation } from '../../../shared/types/mail'
import { groupConversations } from '../../../shared/mail-thread'
import { toMailSearch } from '../../utils/mail-search-query'

/** How many mails one page of conversations is grouped from; the index pages by mail */
const CONVERSATION_SOURCE_LIMIT = 500

// Mail grouped into conversations, newest conversation first. Index only: the
// provider cannot group across folders, so without it the client falls back.
export default defineEventHandler(async (event): Promise<MailConversation[] | { fallback: true }> => {
  const { service, mailbox, limit, offset, scope, ...search } = await getValidatedQuery(event, messagesQuerySchema)

  const index = useMailSearchIndex()
  if (!index) {
    setResponseStatus(event, 409)
    return { fallback: true }
  }

  await requestMailSync(service)

  if (!await isMailboxIndexed(service, mailbox)) {
    setResponseStatus(event, 409)
    return { fallback: true }
  }

  const mails = await index.search({
    services: [service],
    mailbox,
    search: toMailSearch(search),
    limit: CONVERSATION_SOURCE_LIMIT
  })

  return groupConversations(mails).slice(0, limit).map(({ key, subject, participants, count, unread, latest }) => ({
    key,
    subject,
    participants,
    count,
    unread,
    latest
  }))
})
