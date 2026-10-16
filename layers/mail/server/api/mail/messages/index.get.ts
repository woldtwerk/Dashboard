import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import type { MailSearch } from '../../../../shared/types/mail'
import { hasSearchCriteria } from '../../../mail-index/document'

export default defineEventHandler(async (event) => {
  const { service, mailbox, limit, q, unread, flagged, since, before, from } = await getValidatedQuery(event, messagesQuerySchema)
  const search: MailSearch = { text: q || undefined, unread, flagged, since, before, from: from || undefined }

  // Keep the index fresh in the background
  await requestMailSync(service)

  // Searches go to the index once the folder is fully indexed, otherwise to the provider
  const index = useMailSearchIndex()
  if (index && hasSearchCriteria(search) && await isMailboxIndexed(service, mailbox)) {
    return index.search({ services: [service], mailbox, search, limit })
  }

  return (await useMailProvider(service)).listMessages(mailbox, { limit, search })
})
