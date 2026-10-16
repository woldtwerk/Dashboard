import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const id = documentsParamId(event)
  const patch = await readValidatedBody(event, documentsPatchSchema)

  return (await useDocumentsProvider(service)).update(id, patch)
})
