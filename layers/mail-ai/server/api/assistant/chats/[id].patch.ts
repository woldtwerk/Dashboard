import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { renameAssistantChat } from '../../../mail-ai/chats'

const paramsSchema = z.object({
  id: z.string().trim().min(1).max(100)
})

const bodySchema = z.object({
  title: z.string().trim().min(1).max(100)
})

// Renames a stored chat from the chat list
export default defineEventHandler(async (event) => {
  const parsed = paramsSchema.safeParse({ id: getRouterParam(event, 'id') })
  if (!parsed.success) {
    throw createError({ status: 400, statusText: 'Invalid chat id' })
  }

  const { title } = await readValidatedBody(event, bodySchema)
  const chat = await renameAssistantChat(await useDb(), parsed.data.id, title)

  if (!chat) {
    throw createError({ status: 404, statusText: 'Chat not found' })
  }

  return chat
})
