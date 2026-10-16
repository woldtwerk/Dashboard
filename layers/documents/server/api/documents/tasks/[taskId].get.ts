import { createError, defineEventHandler, getRouterParam, getValidatedQuery } from 'nuxt/server'

// Polls one background task, e.g. an upload being consumed
export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)
  const result = documentsTaskIdParamSchema.safeParse({ taskId: getRouterParam(event, 'taskId') })
  if (!result.success) {
    throw createError({ status: 400, statusText: 'Invalid task id' })
  }

  return (await useDocumentsProvider(service)).task(result.data.taskId)
})
