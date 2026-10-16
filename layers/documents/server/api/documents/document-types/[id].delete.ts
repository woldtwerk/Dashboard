import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const id = documentsParamId(event)

  await (await useDocumentsProvider(service)).removeDocumentType(id)

  return { ok: true }
})
