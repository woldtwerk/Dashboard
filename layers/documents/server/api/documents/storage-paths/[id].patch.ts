import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const id = documentsParamId(event)
  const input = await readValidatedBody(event, documentsStoragePathInputSchema)

  return (await useDocumentsProvider(service)).updateStoragePath(id, input)
})
