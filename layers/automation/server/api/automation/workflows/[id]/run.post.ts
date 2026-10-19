import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'

const bodySchema = z.object({
  refs: z.array(z.string().trim().min(1).max(400)).min(1).max(100)
})

/**
 * Runs one workflow on items the user picked (mail or documents), following the
 * workflow's own mode. The refs are entity keys; refs for another domain or
 * service are refused, a missing item fails only itself.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ status: 400, statusText: 'Missing workflow id' })
  }

  const { refs } = await readValidatedBody(event, bodySchema)
  return runWorkflowManually(id, refs)
})
