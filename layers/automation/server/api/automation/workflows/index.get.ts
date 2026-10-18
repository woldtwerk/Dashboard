import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'

const querySchema = z.object({
  domain: z.enum(['mail', 'documents']).optional()
})

export default defineEventHandler(async (event) => {
  const { domain } = await getValidatedQuery(event, querySchema)

  return listWorkflows(domain)
})
