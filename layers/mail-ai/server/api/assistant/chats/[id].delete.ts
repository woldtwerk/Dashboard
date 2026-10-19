import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { z } from 'zod'
import { deleteAssistantChat } from '../../../mail-ai/chats'

const paramsSchema = z.object({
  id: z.string().trim().min(1).max(100)
})

// Deletes a chat; its messages go with it through the foreign key cascade
export default defineEventHandler(async (event) => {
  const parsed = paramsSchema.safeParse({ id: getRouterParam(event, 'id') })
  if (!parsed.success) {
    throw createError({ status: 400, statusText: 'Invalid chat id' })
  }

  if (!await deleteAssistantChat(await useDb(), parsed.data.id)) {
    throw createError({ status: 404, statusText: 'Chat not found' })
  }

  return { ok: true }
})
