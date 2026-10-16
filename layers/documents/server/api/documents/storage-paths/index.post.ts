import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const input = await readValidatedBody(event, documentsStoragePathInputSchema)

  return (await useDocumentsProvider(service)).createStoragePath(input)
})
