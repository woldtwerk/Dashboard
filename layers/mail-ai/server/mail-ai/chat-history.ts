import type { UIMessage } from 'ai'
import { toAssistantUIMessages } from '../../shared/assistant-chat'

/** The message fields the history helpers need; the repository row satisfies this. */
export interface StoredChatMessage {
  id: string
  role: UIMessage['role']
  parts: UIMessage['parts']
  position: number
}

/** The model keeps only the newest messages; the database keeps them all. */
export function capAssistantHistory<T>(messages: T[], limit = 100): T[] {
  return messages.slice(-limit)
}

/** The assistant answer a regenerate request targets: the given message, or the newest when it ends the chat. */
export function findAssistantMessageToRegenerate<T extends Pick<StoredChatMessage, 'id' | 'role'>>(
  messages: T[],
  messageId?: string
): T | undefined {
  if (messageId) {
    return messages.find(message => message.id === messageId && message.role === 'assistant')
  }

  const last = messages.at(-1)
  return last?.role === 'assistant' ? last : undefined
}

/** Everything before the regenerated answer stays in the conversation. */
export function messagesBeforePosition<T extends Pick<StoredChatMessage, 'position'>>(messages: T[], position: number): T[] {
  return messages.filter(message => message.position < position)
}

/** LIKE wildcards are escaped so a search for `%` or `_` is literal. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, char => `\\${char}`)
}

/** Stored messages as the AI SDK wants them, newest `limit` only. */
export function modelHistory(messages: StoredChatMessage[], limit = 100): UIMessage[] {
  return toAssistantUIMessages(capAssistantHistory(messages, limit))
}
