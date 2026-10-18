import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'

const bodySchema = z.object({
  template: z.string().trim().min(1).max(80),
  service: z.string().trim().min(1).max(80).nullable().default(null)
})

/**
 * Creates a workflow from a template. It is stored disabled and in suggest mode,
 * so the user can preview it in the builder before it runs on real items.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema)

  return createWorkflowFromTemplate(body.template, body.service)
})
