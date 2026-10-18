import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { hasSearchCriteria } from '../../../mail-index/document'
import { toMailSearch } from '../../../utils/mail-search-query'

export default defineEventHandler(async (event) => {
  const { service, mailbox, limit, offset, scope, ...search } = await getValidatedQuery(event, messagesQuerySchema)
  const criteria = toMailSearch(search)
  const allFolders = scope === 'all'

  // Keep the index fresh in the background
  await requestMailSync(service)

  // Searches and cross-folder listing come from the index once the wanted folders are fully
  // synced (`scope=all` needs every folder, a single folder only itself); a partial index
  // would answer them incorrectly. Plain browsing stays on the provider, so the newest mail
  // shows without waiting for the next sync.
  const index = useMailSearchIndex()
  if (index && (allFolders || hasSearchCriteria(criteria)) && await isMailboxIndexed(service, allFolders ? undefined : mailbox)) {
    return index.search({ services: [service], mailbox: allFolders ? undefined : mailbox, search: criteria, limit, offset })
  }

  // Plain browsing stays on the provider, which pages by offset; it serves one
  // provider-sized page per request, since the mail server caps a fetch.
  return (await useMailProvider(service)).listMessages(mailbox, { limit: Math.min(limit, MAIL_PROVIDER_MAX_LIMIT), offset, search: criteria })
})
