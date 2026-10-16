import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

// Original or archived file, always as an attachment
export default defineEventHandler(async (event) => {
  const { service, original } = await getValidatedQuery(event, documentsDownloadQuerySchema)
  const id = documentsParamId(event)

  const provider = await useDocumentsProvider(service)
  const document = await provider.get(id)
  const response = await provider.download(id, { original: original ?? false })
  const filename = (original ? document.originalFileName : document.archivedFileName)
    ?? document.originalFileName
    ?? `document-${id}`

  return documentsFileResponse(response, { filename })
})
