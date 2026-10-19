import type { UIMessage } from 'ai'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Stored assistant conversations; the messages are user data, not a cache. */
export const assistantChats = sqliteTable('assistant_chats', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  /** The AI service the conversation last used */
  service: text('service'),
  /** The model the conversation last used */
  model: text('model'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
}, table => [
  index('assistant_chats_updated_at_idx').on(table.updatedAt)
])

/** The messages of an assistant chat, in order. */
export const assistantMessages = sqliteTable('assistant_messages', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull().references(() => assistantChats.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  /** AI SDK UI message parts, stored as JSON */
  parts: text('parts', { mode: 'json' }).$type<UIMessage['parts']>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  /** Position within the chat; the message id stays the AI SDK's id */
  position: integer('position').notNull()
}, table => [
  index('assistant_messages_chat_position_idx').on(table.chatId, table.position)
])
