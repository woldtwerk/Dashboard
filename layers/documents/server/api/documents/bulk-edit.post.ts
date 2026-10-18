import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const body = await readValidatedBody(event, documentsBulkEditBodySchema)

  await (await useDocumentsProvider(service)).bulkEdit(body.documents, body.action)
  await publishDomainEvent({ domain: 'documents', service, type: 'changed' })

  return { ok: true }
})
