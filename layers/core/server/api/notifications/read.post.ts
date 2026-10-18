import { z } from 'zod'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).max(500).optional()
})

/** Marks the given notifications read; without ids, every unread one. */
export default defineEventHandler(async (event) => {
  const { ids } = await readValidatedBody(event, bodySchema)
  const unread = await markNotificationsRead(ids)

  return { unread }
})
