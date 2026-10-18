import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'

const querySchema = z.object({
  ref: z.string().trim().min(1).max(400)
})

/**
 * The item a workflow builder was opened from, read back from its provider. The
 * "Create workflow…" action only carries the item's entity key; the builder asks
 * here for the fields `draftFromItem` turns into a draft graph.
 */
export default defineEventHandler(async (event) => {
  const { ref } = await getValidatedQuery(event, querySchema)

  return loadDraftItem(ref)
})
