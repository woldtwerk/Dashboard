import { createError, getRouterParam } from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'
import { z } from 'zod'

export const serviceQuerySchema = z.object({
  service: z.string().min(1)
})

export const mailboxQuerySchema = serviceQuerySchema.extend({
  mailbox: z.string().min(1).default('INBOX')
})

export const messagesQuerySchema = mailboxQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(200).optional(),
  unread: z.stringbool().optional(),
  flagged: z.stringbool().optional(),
  since: z.iso.date().optional(),
  before: z.iso.date().optional(),
  from: z.string().trim().max(200).optional()
})

export function getUidParam(event: RequestEvent): number {
  const result = z.coerce.number().int().positive().safeParse(getRouterParam(event, 'uid'))

  if (!result.success) {
    throw createError({ status: 400, statusText: 'Invalid message uid' })
  }

  return result.data
}
