import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'

const querySchema = z.object({
  domain: z.enum(['mail', 'documents']).optional(),
  outcome: z.enum(['suggested', 'applied', 'failed', 'undone', 'skipped', 'review']).optional(),
  since: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
})

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, querySchema)

  return listRuns(query)
})
