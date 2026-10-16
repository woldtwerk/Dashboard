import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const id = documentsParamId(event)
  const linkId = documentsParamId(event, 'linkId')

  await (await useDocumentsProvider(service)).removeShareLink(id, linkId)

  return { ok: true }
})
