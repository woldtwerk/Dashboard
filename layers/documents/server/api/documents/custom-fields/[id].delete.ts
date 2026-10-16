import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const id = documentsParamId(event)

  await (await useDocumentsProvider(service)).removeCustomField(id)

  return { ok: true }
})
