import type { UIMessage } from 'ai'
import type { AssistantChatMessage } from './types/assistant'

/** The plain text of a UI message, with whitespace collapsed to single spaces. */
export function assistantMessageText(message: Pick<UIMessage, 'parts'>): string {
  return message.parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The title used before the model writes one: the first words of the question,
 * cut at a word boundary so a 60-character title never splits a word.
 */
export function assistantTitleFromText(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) {
    return clean
  }

  const cut = clean.slice(0, max)
  const boundary = cut.lastIndexOf(' ')
  const title = (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[\s,;:.-]+$/, '')

  return title || cut.trim()
}

/**
 * The model's answer to the title prompt, reduced to at most six words in one
 * line. Quotes and trailing punctuation are dropped; an empty answer is not a
 * title, so the caller keeps the truncated one.
 */
export function normalizeAssistantTitle(value: string, maxWords = 6): string | undefined {
  const clean = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/^[\s"'`*#-]+|[\s"'`*#-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!clean) {
    return undefined
  }

  const words = clean.split(' ').slice(0, maxWords).join(' ')
  const title = words.replace(/[\s,;:.!?]+$/, '').trim()

  return title || undefined
}

/** Stored rows to the AI SDK message shape; rows are already ordered by position. */
export function toAssistantUIMessages(
  messages: Pick<AssistantChatMessage, 'id' | 'role' | 'parts' | 'position'>[]
): UIMessage[] {
  return messages
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(message => ({
      id: message.id,
      role: message.role,
      parts: message.parts
    }))
}
