import { createError, defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import { parseEntityKey } from '../../../shared/entities'

const relatedQuerySchema = z.object({
  ref: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
})

// Related items of one entity, grouped by the domain that found them
export default defineEventHandler(async (event) => {
  const { ref, limit } = await getValidatedQuery(event, relatedQuerySchema)
  const parsed = parseEntityKey(ref)

  if (!parsed) {
    throw createError({ status: 400, statusText: 'Malformed entity reference' })
  }

  return relatedTo(parsed, limit)
})
