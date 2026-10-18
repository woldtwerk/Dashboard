import { createError, defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import { parseEntityKey } from '../../../shared/entities'

const graphQuerySchema = z.object({
  ref: z.string().min(1),
  depth: z.coerce.number().int().min(1).max(2).default(1)
})

// The entity graph around one item; depth 2 also loads the neighbours' neighbours
export default defineEventHandler(async (event) => {
  const { ref, depth } = await getValidatedQuery(event, graphQuerySchema)
  const parsed = parseEntityKey(ref)

  if (!parsed) {
    throw createError({ status: 400, statusText: 'Malformed entity reference' })
  }

  return entityGraph(parsed, depth)
})
