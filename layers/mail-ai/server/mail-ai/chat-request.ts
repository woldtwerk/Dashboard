import { z } from 'zod'
import type { UIMessage } from 'ai'

/**
 * The client may only send a user turn. `assistant` and `system` are rejected,
 * so a crafted request cannot inject a privileged turn into the model history.
 */
export const chatUserMessageSchema = z.object({
  id: z.string().trim().min(1).max(200),
  role: z.literal('user'),
  parts: z.array(z.unknown()).min(1)
})

export type ChatUserMessage = z.infer<typeof chatUserMessageSchema>

/** The validated client message as a UI message, with its role forced to `user`. */
export function toUserUIMessage(message: ChatUserMessage): UIMessage {
  return {
    id: message.id,
    role: 'user',
    parts: message.parts as UIMessage['parts']
  }
}

/** Whether a message id is already stored in the chat. */
export function hasStoredMessage(messages: { id: string }[], id: string): boolean {
  return messages.some(message => message.id === id)
}
