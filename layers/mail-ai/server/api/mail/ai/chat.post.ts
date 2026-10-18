import { convertToModelMessages, stepCountIs, streamText } from 'ai'
import type { UIMessage } from 'ai'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { createMailAccess } from '../../../mail-ai/access'
import { assistantInstructions, createAssistantTools } from '../../../mail-ai/assistant'

// Chat with the mail assistant; streams UI messages (AI SDK protocol)
export default defineEventHandler(async (event) => {
  const { id, messages, service, model } = await readValidatedBody(event, z.object({
    id: z.string().max(100),
    messages: z.array(z.custom<UIMessage>(message => typeof message === 'object' && message !== null)).min(1).max(100),
    service: z.string().max(100).optional(),
    model: aiModelIdSchema.optional()
  }))

  // One provider session per conversation; the client may pick the service and model
  const aiModel = await useAiModel({ session: id, service, model })
  const tools = createAssistantTools(createMailAccess())

  const result = streamText({
    model: aiModel.model,
    headers: aiModel.headers,
    system: assistantInstructions(new Date().toISOString().slice(0, 10)),
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    stopWhen: stepCountIs(6)
  })

  return result.toUIMessageStreamResponse()
})
