import { defineEventHandler, getValidatedQuery, setResponseStatus } from 'nuxt/server'
import type { MailConversation } from '../../../shared/types/mail'
import { loadConversationPage } from '../../utils/mail-conversations'
import { toMailSearch } from '../../utils/mail-search-query'

// Mail grouped into conversations, newest conversation first, paged over the
// grouped result. Index only: the provider cannot group across folders, so
// without it the client falls back.
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

  return loadConversationPage(
    (sourceOffset, size) => index.search({
      services: [service],
      mailbox,
      search: toMailSearch(search),
      limit: size,
      offset: sourceOffset
    }),
    offset,
    limit
  )
})
