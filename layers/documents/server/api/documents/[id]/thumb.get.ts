import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

// Thumbnail image; the header builder forces an inline raster type and nosniff
export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const id = documentsParamId(event)

  const response = await (await useDocumentsProvider(service)).thumbnail(id)

  return documentsFileResponse(response, { filename: `document-${id}-thumb`, inline: true })
})
