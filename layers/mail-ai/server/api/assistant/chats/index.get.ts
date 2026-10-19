import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import { listAssistantChats } from '../../../mail-ai/chats'

const chatQuerySchema = z.object({
  q: z.string().trim().max(100).optional()
})

// Recent assistant chats, newest first; `?q=` narrows the list by title
export default defineEventHandler(async (event) => {
  const { q } = await getValidatedQuery(event, chatQuerySchema)

  return await listAssistantChats(await useDb(), q)
})
