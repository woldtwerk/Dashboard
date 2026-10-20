import { createError, defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { hasSearchCriteria } from '../../../mail-index/document'
import { labelMailbox } from '../../../../shared/mail-labels'
import { INDEX_ONLY_PROVIDER_ERROR, mailListSource, providerCannotAnswer } from '../../../utils/mail-list-source'
import { toMailSearch } from '../../../utils/mail-search-query'

export default defineEventHandler(async (event) => {
  const { service, mailbox, limit, offset, scope, ...search } = await getValidatedQuery(event, messagesQuerySchema)
  const criteria = toMailSearch(search)
  const allFolders = scope === 'all'

  // Keep the index fresh in the background
  await requestMailSync(service)

  // The index answers every list — plain browsing included — once the wanted
  // folders are fully synced, so the result is always sorted by date. Cross-folder
  // listing only covers real folders: a label would repeat the mail it shares
  // with a folder. A partial index would answer incorrectly, so the provider
  // serves a folder until its first full sync finished.
  const index = useMailSearchIndex()
  const mailboxes = index && allFolders ? searchableMailboxes(await (await useMailProvider(service)).listMailboxes()) : undefined
  const indexed = index ? await isMailboxIndexed(service, allFolders ? mailboxes : mailbox) : false
  const source = mailListSource({ indexAvailable: !!index, indexed, allFolders, hasCriteria: hasSearchCriteria(criteria) })

  if (source === 'provider' && providerCannotAnswer(criteria)) {
    throw createError({ status: 409, statusText: INDEX_ONLY_PROVIDER_ERROR })
  }

  if (source === 'index' && index) {
    return index.search({
      services: [service],
      mailbox: allFolders ? undefined : mailbox,
      mailboxes,
      search: criteria,
      limit,
      offset
    })
  }

  // Until the folder is indexed, the provider pages by offset; it serves one
  // provider-sized page per request, since the mail server caps a fetch. A label
  // filter browses the label folder itself, which repeats the labelled mail.
  const providerMailbox = criteria.label ? labelMailbox(criteria.label) : mailbox
  return (await useMailProvider(service)).listMessages(providerMailbox, { limit: Math.min(limit, MAIL_PROVIDER_MAX_LIMIT), offset, search: criteria })
})
