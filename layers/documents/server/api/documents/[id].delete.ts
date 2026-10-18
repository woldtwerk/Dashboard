import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const id = documentsParamId(event)

  await (await useDocumentsProvider(service)).remove(id)
  await publishDomainEvent({ domain: 'documents', service, type: 'changed', resource: String(id) })

  return { ok: true }
})
