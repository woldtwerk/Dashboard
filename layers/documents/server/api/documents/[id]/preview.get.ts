import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

// Rendered document (PDF/image); inline only for safe types, see sendDocumentsFile
export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const id = documentsParamId(event)

  const response = await (await useDocumentsProvider(service)).preview(id)

  return documentsFileResponse(response, { filename: `document-${id}`, inline: true })
})
