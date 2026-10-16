import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { toMailSearch } from '../../utils/mail-search-query'

// Filter suggestions for the current query; null without a search index
export default defineEventHandler(async (event) => {
  const index = useMailSearchIndex()
  if (!index) {
    return null
  }

  const { service, mailbox, scope, ...search } = await getValidatedQuery(event, facetsQuerySchema)
  const allFolders = scope === 'all'

  if (!await isMailboxIndexed(service, allFolders ? undefined : mailbox)) {
    return { from: [] }
  }

  return index.facets({
    services: [service],
    mailbox: allFolders ? undefined : mailbox,
    search: toMailSearch(search)
  })
})
