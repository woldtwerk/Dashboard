import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import type { UIMessage } from 'ai'
import type { AssistantChat, AssistantChatMessage, AssistantChatSummary } from '../../shared/types/assistant'
import type { Database } from '../../../core/server/db/client'
import { assistantChats, assistantMessages } from '../db/schema'
import { escapeLike } from './chat-history'

export type AssistantChatRow = typeof assistantChats.$inferSelect
export type AssistantMessageRow = typeof assistantMessages.$inferSelect

/** A message to store; the position is assigned by the repository. */
export interface NewAssistantMessage {
  id: string
  role: UIMessage['role']
  parts: UIMessage['parts']
  createdAt?: Date
}

export interface NewAssistantChat {
  id: string
  title: string
  service?: string | null
  model?: string | null
  now: Date
}

export function toChatSummary(row: AssistantChatRow): AssistantChatSummary {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString()
  }
}

export function toChatMessage(row: AssistantMessageRow): AssistantChatMessage {
  return {
    id: row.id,
    role: row.role,
    parts: row.parts,
    createdAt: row.createdAt.toISOString(),
    position: row.position
  }
}

export function toChatDetail(row: AssistantChatRow, messages: AssistantMessageRow[]): AssistantChat {
  return {
    ...toChatSummary(row),
    service: row.service,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    messages: messages.map(toChatMessage)
  }
}

export async function listAssistantChats(db: Database, query?: string): Promise<AssistantChatSummary[]> {
  const term = query?.trim()
  const rows = await db.select().from(assistantChats)
    .where(term
      ? sql`${assistantChats.title} LIKE ${`%${escapeLike(term)}%`} ESCAPE '\\'`
      : undefined)
    .orderBy(desc(assistantChats.updatedAt))

  return rows.map(toChatSummary)
}

export async function findAssistantChat(db: Database, id: string): Promise<AssistantChatRow | undefined> {
  return await db.select().from(assistantChats).where(eq(assistantChats.id, id)).get()
}

export async function listAssistantMessages(db: Database, chatId: string): Promise<AssistantMessageRow[]> {
  return await db.select().from(assistantMessages)
    .where(eq(assistantMessages.chatId, chatId))
    .orderBy(asc(assistantMessages.position), asc(assistantMessages.createdAt))
}

export async function getAssistantChat(db: Database, id: string): Promise<AssistantChat | undefined> {
  const chat = await findAssistantChat(db, id)
  if (!chat) {
    return undefined
  }

  return toChatDetail(chat, await listAssistantMessages(db, id))
}

/** Creates the chat on its first message; later messages only update service, model and time. */
export async function ensureAssistantChat(db: Database, chat: NewAssistantChat): Promise<void> {
  await db.insert(assistantChats).values({
    id: chat.id,
    title: chat.title,
    service: chat.service ?? null,
    model: chat.model ?? null,
    createdAt: chat.now,
    updatedAt: chat.now
  }).onConflictDoUpdate({
    target: assistantChats.id,
    set: {
      service: chat.service ?? null,
      model: chat.model ?? null,
      updatedAt: chat.now
    }
  })
}

export async function touchAssistantChat(
  db: Database,
  id: string,
  values: { service?: string | null, model?: string | null, now: Date }
): Promise<void> {
  await db.update(assistantChats)
    .set({
      ...(values.service !== undefined ? { service: values.service } : {}),
      ...(values.model !== undefined ? { model: values.model } : {}),
      updatedAt: values.now
    })
    .where(eq(assistantChats.id, id))
}

export async function appendAssistantMessages(
  db: Database,
  chatId: string,
  messages: NewAssistantMessage[],
  now = new Date()
): Promise<void> {
  if (!messages.length) {
    return
  }

  const row = await db.select({
    maxPosition: sql<number>`coalesce(max(${assistantMessages.position}), -1)`
  }).from(assistantMessages).where(eq(assistantMessages.chatId, chatId)).get()
  let position = Number(row?.maxPosition ?? -1) + 1

  await db.transaction(async (tx) => {
    await tx.insert(assistantMessages).values(messages.map(message => ({
      id: message.id,
      chatId,
      role: message.role,
      parts: message.parts,
      createdAt: message.createdAt ?? now,
      position: position++
    }))).onConflictDoNothing()

    await tx.update(assistantChats).set({ updatedAt: now }).where(eq(assistantChats.id, chatId))
  })
}

/** Drops an assistant answer and everything after it, so regenerate can answer again. */
export async function deleteAssistantMessagesFrom(db: Database, chatId: string, position: number): Promise<void> {
  await db.delete(assistantMessages).where(and(
    eq(assistantMessages.chatId, chatId),
    gte(assistantMessages.position, position)
  ))
}

export async function renameAssistantChat(db: Database, id: string, title: string): Promise<AssistantChatSummary | undefined> {
  const [row] = await db.update(assistantChats)
    .set({ title })
    .where(eq(assistantChats.id, id))
    .returning()

  return row ? toChatSummary(row) : undefined
}

/**
 * Replaces the truncated title only while it is still the placeholder, so a
 * rename made while the model was answering is not overwritten.
 */
export async function replaceGeneratedAssistantTitle(
  db: Database,
  id: string,
  title: string,
  previousTitle: string
): Promise<boolean> {
  const rows = await db.update(assistantChats)
    .set({ title })
    .where(and(eq(assistantChats.id, id), eq(assistantChats.title, previousTitle)))
    .returning({ id: assistantChats.id })

  return rows.length > 0
}

export async function deleteAssistantChat(db: Database, id: string): Promise<boolean> {
  const rows = await db.delete(assistantChats).where(eq(assistantChats.id, id)).returning({ id: assistantChats.id })

  return rows.length > 0
}
