import { describe, expect, it } from 'vitest'
import type { AssistantChatSummary } from '../shared/types/assistant'
import { assistantMessageText, assistantTitleFromText, normalizeAssistantTitle, toAssistantUIMessages } from '../shared/assistant-chat'
import { groupAssistantChats } from '../app/utils/assistant-chats'
import {
  capAssistantHistory,
  escapeLike,
  findAssistantMessageToRegenerate,
  messagesBeforePosition
} from '../server/mail-ai/chat-history'
import type { StoredChatMessage } from '../server/mail-ai/chat-history'

const now = new Date(2026, 9, 19, 12)

function chat(id: string, daysAgo: number): AssistantChatSummary {
  const date = new Date(now)
  date.setDate(date.getDate() - daysAgo)

  return { id, title: id, updatedAt: date.toISOString() }
}

function message(id: string, role: StoredChatMessage['role'], position: number): StoredChatMessage {
  return {
    id,
    role,
    parts: [],
    position
  }
}

describe('assistantMessageText', () => {
  it('joins text parts and collapses whitespace', () => {
    expect(assistantMessageText({ parts: [
      { type: 'text', text: ' Hello\n' },
      { type: 'step-start' },
      { type: 'text', text: 'world ' }
    ] })).toBe('Hello world')
  })
})

describe('assistantTitleFromText', () => {
  it('keeps a short question as it is', () => {
    expect(assistantTitleFromText('Summarize my unread mails')).toBe('Summarize my unread mails')
  })

  it('cuts a long question at a word boundary without exceeding 60 characters', () => {
    const title = assistantTitleFromText('Which invoices did I get this month from the companies I work with every day?')

    expect(title.length).toBeLessThanOrEqual(60)
    expect(title.endsWith(' ')).toBe(false)
    expect(title.split(' ').every(word => word.length > 0)).toBe(true)
    expect('Which invoices did I get this month from the companies I work with every day?').toContain(title)
  })

  it('falls back to a hard cut when there is no space', () => {
    expect(assistantTitleFromText('x'.repeat(80), 10)).toBe('x'.repeat(10))
  })
})

describe('normalizeAssistantTitle', () => {
  it('drops quotes, newlines and trailing punctuation', () => {
    expect(normalizeAssistantTitle('"Unread invoices this month."')).toBe('Unread invoices this month')
  })

  it('keeps at most six words', () => {
    expect(normalizeAssistantTitle('one two three four five six seven eight')).toBe('one two three four five six')
  })

  it('rejects an empty answer', () => {
    expect(normalizeAssistantTitle('  "  ')).toBeUndefined()
  })
})

describe('groupAssistantChats', () => {
  it('groups newest first into Today, Yesterday, Last 7 days and Older', () => {
    const groups = groupAssistantChats([
      chat('today', 0),
      chat('yesterday', 1),
      chat('week', 4),
      chat('old', 30)
    ], 'UTC', now)

    expect(groups.map(group => group.label)).toEqual(['Today', 'Yesterday', 'Last 7 days', 'Older'])
    expect(groups.map(group => group.items.map(item => item.id))).toEqual([
      ['today'],
      ['yesterday'],
      ['week'],
      ['old']
    ])
  })

  it('leaves out empty groups', () => {
    const groups = groupAssistantChats([chat('today', 0)], 'UTC', now)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.id).toBe('today')
  })

  it('keeps the order of the list inside a group', () => {
    const groups = groupAssistantChats([chat('a', 0), chat('b', 0)], 'UTC', now)

    expect(groups[0]?.items.map(item => item.id)).toEqual(['a', 'b'])
  })

  it('counts days in the given zone, not in the process zone', () => {
    // 22:30 UTC on 18 October is already 00:30 on 19 October in Berlin
    const chatAt = { id: 'boundary', title: 'boundary', updatedAt: '2026-10-18T22:30:00Z' }

    const berlin = groupAssistantChats([chatAt], 'Europe/Berlin', now)
    const utc = groupAssistantChats([chatAt], 'UTC', now)

    expect(berlin[0]?.id).toBe('today')
    expect(utc[0]?.id).toBe('yesterday')
  })
})

describe('chat history helpers', () => {
  const messages = [
    message('u1', 'user', 0),
    message('a1', 'assistant', 1),
    message('u2', 'user', 2),
    message('a2', 'assistant', 3)
  ]

  it('caps what is sent to the model, dropping the oldest first', () => {
    expect(capAssistantHistory(messages, 2).map(item => item.id)).toEqual(['u2', 'a2'])
    expect(messages).toHaveLength(4)
  })

  it('finds the requested assistant message or the newest one when the chat ends with an answer', () => {
    expect(findAssistantMessageToRegenerate(messages)?.id).toBe('a2')
    expect(findAssistantMessageToRegenerate(messages, 'a1')?.id).toBe('a1')
    expect(findAssistantMessageToRegenerate(messages, 'u2')).toBeUndefined()
  })

  it('does not target an older answer when the chat ends with a question', () => {
    expect(findAssistantMessageToRegenerate([
      message('u1', 'user', 0),
      message('a1', 'assistant', 1),
      message('u2', 'user', 2)
    ])).toBeUndefined()
  })

  it('keeps everything before the regenerated answer', () => {
    expect(messagesBeforePosition(messages, 3).map(item => item.id)).toEqual(['u1', 'a1', 'u2'])
  })
})

describe('escapeLike', () => {
  it('escapes SQL LIKE wildcards and backslashes', () => {
    expect(escapeLike('100%_done\\')).toBe('100\\%\\_done\\\\')
  })
})

describe('toAssistantUIMessages', () => {
  it('orders stored messages by position and keeps id, role and parts', () => {
    const messages = [message('a', 'assistant', 1), message('u', 'user', 0)]

    expect(toAssistantUIMessages(messages).map(item => item.id)).toEqual(['u', 'a'])
  })
})
