import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'

// Streams the provider's archive back; headers are set by sendDocumentsFile
export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const body = await readValidatedBody(event, documentsBulkDownloadBodySchema)

  const response = await (await useDocumentsProvider(service)).bulkDownload(body.documents, {
    content: body.content,
    compression: body.compression
  })

  return documentsFileResponse(response, { filename: 'documents.zip' })
})
