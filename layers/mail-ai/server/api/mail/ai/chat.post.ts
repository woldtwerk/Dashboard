import { convertToModelMessages, stepCountIs, streamText } from 'ai'
import type { UIMessage } from 'ai'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { listDomainTools } from '../../../../../core/server/utils/domain-tools'
import { getSettings } from '../../../../../core/server/utils/settings'
import type { AssistantSettings } from '../../../../shared/types/assistant'
import { assistantInstructions, resolveAssistantDomains } from '../../../mail-ai/assistant'
import { toAiSdkTools } from '../../../mail-ai/tools'

// Chat with the assistant; streams UI messages (AI SDK protocol)
export default defineEventHandler(async (event) => {
  const { id, messages, service, model } = await readValidatedBody(event, z.object({
    id: z.string().max(100),
    messages: z.array(z.custom<UIMessage>(message => typeof message === 'object' && message !== null)).min(1).max(100),
    service: z.string().max(100).optional(),
    model: aiModelIdSchema.optional()
  }))

  // One provider session per conversation; the client may pick the service and model
  const aiModel = await useAiModel({ session: id, service, model })
  // The user picks the readable domains per domain; the runtime config is the fallback
  const settings = await getSettings<AssistantSettings>('assistant')
  const domains = resolveAssistantDomains(settings.domains, useRuntimeConfig().assistant.domains)
  // Write tools are never handed to the assistant: it may only read
  const tools = toAiSdkTools(listDomainTools({ scope: 'read', domains }), { scope: 'read', caller: 'assistant' })

  const result = streamText({
    model: aiModel.model,
    headers: aiModel.headers,
    system: assistantInstructions(new Date().toISOString().slice(0, 10), domains),
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    stopWhen: stepCountIs(6)
  })

  return result.toUIMessageStreamResponse()
})
