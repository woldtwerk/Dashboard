import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const id = documentsParamId(event)
  const input = await readValidatedBody(event, documentsCustomFieldInputSchema)

  return (await useDocumentsProvider(service)).updateCustomField(id, input)
})
