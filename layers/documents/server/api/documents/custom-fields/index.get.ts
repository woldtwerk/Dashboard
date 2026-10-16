import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)

  return (await useDocumentsProvider(service)).listCustomFields()
})
