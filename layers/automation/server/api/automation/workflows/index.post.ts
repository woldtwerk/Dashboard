import { defineEventHandler, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, automationWorkflowCreateSchema)

  return createWorkflow(input)
})
