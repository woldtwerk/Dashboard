import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { z } from 'zod'
import { getAssistantChat } from '../../../mail-ai/chats'

const paramsSchema = z.object({
  id: z.string().trim().min(1).max(100)
})

// One stored chat with its messages, so a reload can read the conversation again
export default defineEventHandler(async (event) => {
  const parsed = paramsSchema.safeParse({ id: getRouterParam(event, 'id') })
  if (!parsed.success) {
    throw createError({ status: 400, statusText: 'Invalid chat id' })
  }

  const chat = await getAssistantChat(await useDb(), parsed.data.id)
  if (!chat) {
    throw createError({ status: 404, statusText: 'Chat not found' })
  }

  return chat
})
