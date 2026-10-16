import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { documentsQueryFromUrl } from '../../../shared/documents-query'

// Document list: filters, full-text search, "more like this", sort, pagination
export default defineEventHandler(async (event) => {
  const { service, ...query } = await getValidatedQuery(event, documentsListQuerySchema)

  return (await useDocumentsProvider(service)).list(documentsQueryFromUrl(query))
})
