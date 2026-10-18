import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'

const bodySchema = z.object({
  ids: z.array(z.string().min(1).max(80)).min(1).max(200)
})

export default defineEventHandler(async (event) => {
  const { ids } = await readValidatedBody(event, bodySchema)

  return reorderWorkflows(ids)
})
