import { defineEventHandler, getValidatedQuery, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const ids = await readValidatedBody(event, documentsTasksBodySchema)

  await (await useDocumentsProvider(service)).acknowledgeTasks(ids)

  return { ok: true }
})
