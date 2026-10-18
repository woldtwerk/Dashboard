import { z } from 'zod'
import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.iso.datetime().optional()
})

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, querySchema)

  return listNotifications(query)
})
