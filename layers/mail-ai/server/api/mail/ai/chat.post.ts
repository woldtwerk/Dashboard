import { randomUUID } from 'node:crypto'
import { convertToModelMessages, stepCountIs, streamText } from 'ai'
import type { UIMessage } from 'ai'
import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { listDomainTools } from '../../../../../core/server/utils/domain-tools'
import { getSettings } from '../../../../../core/server/utils/settings'
import type { AssistantSettings } from '../../../../shared/types/assistant'
import { assistantMessageText, assistantTitleFromText, toAssistantUIMessages } from '../../../../shared/assistant-chat'
import { assistantInstructions, resolveAssistantDomains } from '../../../mail-ai/assistant'
import { assistantDomainInfos } from '../../../mail-ai/domains'
import { generateAssistantChatTitle } from '../../../mail-ai/chat-title'
import { chatUserMessageSchema, hasStoredMessage, toUserUIMessage } from '../../../mail-ai/chat-request'
import {
  capAssistantHistory,
  findAssistantMessageToRegenerate,
  messagesBeforePosition,
  modelHistory
} from '../../../mail-ai/chat-history'
import {
  appendAssistantMessages,
  deleteAssistantMessagesFrom,
  ensureAssistantChat,
  findAssistantChat,
  listAssistantMessages,
  touchAssistantChat
} from '../../../mail-ai/chats'
import { toAiSdkTools } from '../../../mail-ai/tools'

const chatRequestSchema = z.object({
  id: z.string().trim().min(1).max(100),
  message: chatUserMessageSchema,
  /** The AI SDK sends `regenerate-message` when the user asks for another answer */
  trigger: z.enum(['submit-message', 'regenerate-message']).default('submit-message'),
  messageId: z.string().trim().max(200).optional(),
  service: z.string().max(100).optional(),
  model: aiModelIdSchema.optional()
})

// Chat with the assistant; the stored history is the source of truth, so the
// client only sends its new message. Streams UI messages (AI SDK protocol).
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, chatRequestSchema)
  // The validated fields only: the role is always `user`, whatever the client sent
  const message = toUserUIMessage(body.message)
  const now = new Date()
  const db = await useDb()

  // One provider session per conversation; the client may pick the service and model
  const aiModel = await useAiModel({ session: body.id, service: body.service, model: body.model })

  const existing = await findAssistantChat(db, body.id)
  const stored = existing ? await listAssistantMessages(db, body.id) : []
  let history: UIMessage[]
  let question = ''
  let previousTitle = existing?.title ?? 'New chat'
  let firstAnswer = false

  if (body.trigger === 'regenerate-message') {
    if (!existing) {
      throw createError({ status: 404, statusText: 'Chat not found' })
    }

    const target = findAssistantMessageToRegenerate(stored, body.messageId)
    if (body.messageId && !target) {
      throw createError({ status: 400, statusText: 'The message to regenerate was not found' })
    }

    // Drop the answer and everything after it. Without an answer (a failed
    // first request), the last user message is answered again.
    if (target) {
      await deleteAssistantMessagesFrom(db, body.id, target.position)
    }

    const remaining = target ? messagesBeforePosition(stored, target.position) : stored
    if (remaining.at(-1)?.role !== 'user') {
      throw createError({ status: 400, statusText: 'There is no user message to answer' })
    }

    await touchAssistantChat(db, body.id, { service: body.service, model: body.model, now })
    history = modelHistory(remaining)
    question = assistantMessageText(toAssistantUIMessages(remaining).at(-1)!)
    firstAnswer = !stored.some(item => item.role === 'assistant')
  } else {
    question = assistantMessageText(message)
    const title = assistantTitleFromText(question) || 'New chat'
    firstAnswer = !stored.some(item => item.role === 'assistant')

    // A repeated id must not silently overwrite or fail inside the database
    if (hasStoredMessage(stored, message.id)) {
      throw createError({ status: 409, statusText: 'This message was already sent' })
    }

    await ensureAssistantChat(db, {
      id: body.id,
      title,
      service: body.service,
      model: body.model,
      now
    })
    await appendAssistantMessages(db, body.id, [{
      id: message.id,
      role: 'user',
      parts: message.parts,
      createdAt: now
    }], now)

    history = capAssistantHistory([...toAssistantUIMessages(stored), message])
    previousTitle = existing?.title ?? title
  }

  // The user picks the readable domains per domain; the runtime config is the fallback
  const settings = await getSettings<AssistantSettings>('assistant')
  const domains = resolveAssistantDomains(settings.domains, useRuntimeConfig().assistant.domains)
  // Write tools are never handed to the assistant: it may only read
  const readTools = listDomainTools({ scope: 'read' })
  const enabled = new Set(domains)
  const availableTools = readTools.filter(item => enabled.has(item.domain))
  // The areas that exist but the user did not enable; the prompt names them so
  // the answer can point at Settings instead of silently missing data
  const disabledDomains = assistantDomainInfos(readTools.filter(item => !enabled.has(item.domain)))
  const tools = toAiSdkTools(availableTools, { scope: 'read', caller: 'assistant' })

  const result = streamText({
    model: aiModel.model,
    headers: aiModel.headers,
    system: assistantInstructions(new Date().toISOString().slice(0, 10), domains, disabledDomains),
    messages: await convertToModelMessages(history, { tools }),
    tools,
    stopWhen: stepCountIs(6)
  })

  const originalIds = new Set(history.map(item => item.id))

  return result.toUIMessageStreamResponse({
    originalMessages: history,
    // Without an id the client and the database would each invent one, and a
    // later regenerate could not name the stored answer.
    generateMessageId: () => randomUUID(),
    onFinish: async ({ messages, isAborted }) => {
      const answers = messages.filter(item => !originalIds.has(item.id) && item.role === 'assistant' && item.parts.length > 0)

      try {
        if (answers.length) {
          await appendAssistantMessages(db, body.id, answers.map(item => ({
            id: item.id,
            role: item.role,
            parts: item.parts
          })))
        }

        // A title is written once, after the first answer; the truncated one stays on failure
        if (firstAnswer && !isAborted && answers.length) {
          void generateAssistantChatTitle(db, {
            model: aiModel.model,
            headers: aiModel.headers,
            chatId: body.id,
            question,
            previousTitle
          })
        }
      } catch (error) {
        console.error('[assistant] The answer could not be stored', error)
      }
    }
  })
})
