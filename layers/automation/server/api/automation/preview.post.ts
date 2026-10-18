import { defineEventHandler, readValidatedBody } from 'nuxt/server'

/**
 * Dry-runs a workflow graph against recent items, one picked item or free text.
 * Nothing is applied and the graph is validated first. One preview runs per user
 * at a time (a lock), and never over more than 50 items.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, workflowPreviewSchema)
  const { user } = await getUserSession(event)

  return previewWorkflow(body, user?.id ?? 'anonymous')
})
