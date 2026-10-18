import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'

const searchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5)
})

// Global search (Ctrl+K): every domain's registered provider, in parallel
export default defineEventHandler(async (event) => {
  const { q, limit } = await getValidatedQuery(event, searchQuerySchema)

  // A single character matches too much; the palette only asks from two on
  if (!q || q.length < 2) {
    return []
  }

  return searchAll(q, limit)
})
