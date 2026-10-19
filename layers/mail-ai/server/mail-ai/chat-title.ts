import { generateText } from 'ai'
import type { LanguageModel } from 'ai'
import { normalizeAssistantTitle } from '../../shared/assistant-chat'
import type { Database } from '../../../core/server/db/client'
import { replaceGeneratedAssistantTitle } from './chats'

export interface ChatTitleOptions {
  model: LanguageModel
  headers?: Record<string, string>
  chatId: string
  question: string
  /** The truncated title currently stored, so a manual rename is not overwritten */
  previousTitle: string
}

const TITLE_INSTRUCTIONS = [
  'Write a title for a chat that starts with the question below.',
  'Use at most six words and the language of the question.',
  'Answer with the title only, without quotes, markdown or punctuation at the end.'
].join('\n')

/**
 * Writes a short title after the first answer. Runs in the background; a
 * failure leaves the truncated question title in place.
 */
export async function generateAssistantChatTitle(
  db: Database,
  options: ChatTitleOptions
): Promise<string | undefined> {
  try {
    const { text } = await generateText({
      model: options.model,
      headers: options.headers,
      system: TITLE_INSTRUCTIONS,
      prompt: options.question,
      maxOutputTokens: 40
    })
    const title = normalizeAssistantTitle(text)

    if (!title) {
      return undefined
    }

    await replaceGeneratedAssistantTitle(db, options.chatId, title, options.previousTitle)

    return title
  } catch (error) {
    // The answer already reached the user; a missing title is not an error
    console.warn('[assistant] Chat title could not be generated', error)
    return undefined
  }
}
