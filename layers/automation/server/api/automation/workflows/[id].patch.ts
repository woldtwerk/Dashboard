import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ status: 400, statusText: 'Missing workflow id' })
  }

  const patch = await readValidatedBody(event, automationWorkflowPatchSchema)
  return updateWorkflow(id, patch)
})
