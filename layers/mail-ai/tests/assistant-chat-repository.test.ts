import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, openSqlite } from '../../core/server/db/client'
import type { Database } from '../../core/server/db/client'
import { loadMigrations, runMigrations } from '../../core/server/db/migrate'
import {
  appendAssistantMessages,
  deleteAssistantChat,
  deleteAssistantMessagesFrom,
  ensureAssistantChat,
  getAssistantChat,
  listAssistantChats,
  renameAssistantChat,
  replaceGeneratedAssistantTitle
} from '../server/mail-ai/chats'
import type { NewAssistantMessage } from '../server/mail-ai/chats'

const migrationsDir = fileURLToPath(new URL('../../core/server/db/migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

function userMessage(id: string, text: string): NewAssistantMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] }
}

describe('assistant chat repository', () => {
  let db: Database

  beforeEach(async () => {
    const sqlite = openSqlite(':memory:')
    runMigrations(sqlite, await loadMigrations(readMigration))
    db = createDatabase(sqlite)
  })

  it('creates the chat with its first message and lists it newest first', async () => {
    await ensureAssistantChat(db, { id: 'older', title: 'Older', now: new Date(2026, 9, 1) })
    await appendAssistantMessages(db, 'older', [userMessage('u1', 'first')], new Date(2026, 9, 1))

    await ensureAssistantChat(db, { id: 'newer', title: 'Newer', service: 'svc', model: 'mdl', now: new Date(2026, 9, 2) })
    await appendAssistantMessages(db, 'newer', [userMessage('u2', 'second')], new Date(2026, 9, 2))

    expect((await listAssistantChats(db)).map(chat => chat.id)).toEqual(['newer', 'older'])
    expect(await listAssistantChats(db, 'new')).toMatchObject([{ id: 'newer' }])
    expect(await listAssistantChats(db, '%')).toEqual([])
  })

  it('keeps messages ordered by position and returns them with the chat', async () => {
    await ensureAssistantChat(db, { id: 'chat', title: 'Chat', now: new Date(2026, 9, 1) })
    await appendAssistantMessages(db, 'chat', [
      userMessage('u1', 'question'),
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'answer' }] }
    ])
    await appendAssistantMessages(db, 'chat', [userMessage('u2', 'follow up')])

    const chat = await getAssistantChat(db, 'chat')
    expect(chat?.messages.map(message => [message.id, message.position])).toEqual([
      ['u1', 0],
      ['a1', 1],
      ['u2', 2]
    ])
    expect(chat?.messages[1]?.parts).toEqual([{ type: 'text', text: 'answer' }])
  })

  it('drops an answer and everything after it, and deletes the chat with its messages', async () => {
    await ensureAssistantChat(db, { id: 'chat', title: 'Chat', now: new Date(2026, 9, 1) })
    await appendAssistantMessages(db, 'chat', [
      userMessage('u1', 'question'),
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'answer' }] },
      userMessage('u2', 'follow up')
    ])

    await deleteAssistantMessagesFrom(db, 'chat', 1)
    expect((await getAssistantChat(db, 'chat'))?.messages.map(message => message.id)).toEqual(['u1'])

    expect(await deleteAssistantChat(db, 'chat')).toBe(true)
    expect(await getAssistantChat(db, 'chat')).toBeUndefined()
    expect(await deleteAssistantChat(db, 'chat')).toBe(false)
  })

  it('renames a chat and only replaces a generated title while the placeholder is there', async () => {
    await ensureAssistantChat(db, { id: 'chat', title: 'First question', now: new Date(2026, 9, 1) })

    expect(await replaceGeneratedAssistantTitle(db, 'chat', 'Short title', 'First question')).toBe(true)
    expect((await listAssistantChats(db))[0]?.title).toBe('Short title')
    expect(await replaceGeneratedAssistantTitle(db, 'chat', 'Stale title', 'First question')).toBe(false)

    expect(await renameAssistantChat(db, 'chat', 'My title')).toMatchObject({ id: 'chat', title: 'My title' })
    expect(await renameAssistantChat(db, 'missing', 'Nope')).toBeUndefined()
  })
})
