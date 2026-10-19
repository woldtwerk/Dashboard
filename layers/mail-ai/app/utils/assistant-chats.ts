import { differenceInCalendarDays, subDays } from 'date-fns'
import type { AssistantChatSummary } from '#layers/mail-ai/shared/types/assistant'
import { isSameZonedDay, zoned } from '#layers/core/shared/date-format'

/** The shared Nuxt data key of the chat list. */
export const ASSISTANT_CHATS_KEY = 'assistant-chats'

/** The shared Nuxt data key of one chat, used by the page and its hover prefetch. */
export function assistantChatKey(id: string): string {
  return `assistant-chat-${id}`
}

export interface AssistantChatGroup {
  id: 'today' | 'yesterday' | 'last-7-days' | 'older'
  label: string
  items: AssistantChatSummary[]
}

/**
 * Splits the newest-first chat list into Today, Yesterday, Last 7 days and
 * Older. Empty groups are left out, so the list has no dangling headings.
 * Days are counted in `zone`, so a chat lands in the same group on the server
 * and in the browser.
 */
export function groupAssistantChats(
  chats: AssistantChatSummary[],
  zone: string,
  now = new Date()
): AssistantChatGroup[] {
  const buckets: Record<AssistantChatGroup['id'], AssistantChatSummary[]> = {
    'today': [],
    'yesterday': [],
    'last-7-days': [],
    'older': []
  }

  const today = zoned(now, zone)
  const yesterday = subDays(today, 1)

  for (const chat of chats) {
    const date = chat.updatedAt

    if (isSameZonedDay(date, today, zone)) {
      buckets.today.push(chat)
    } else if (isSameZonedDay(date, yesterday, zone)) {
      buckets.yesterday.push(chat)
    } else {
      const days = differenceInCalendarDays(today, zoned(date, zone))
      if (days >= 0 && days <= 7) {
        buckets['last-7-days'].push(chat)
      } else {
        buckets.older.push(chat)
      }
    }
  }

  return [
    { id: 'today' as const, label: 'Today', items: buckets.today },
    { id: 'yesterday' as const, label: 'Yesterday', items: buckets.yesterday },
    { id: 'last-7-days' as const, label: 'Last 7 days', items: buckets['last-7-days'] },
    { id: 'older' as const, label: 'Older', items: buckets.older }
  ].filter(group => group.items.length > 0)
}
