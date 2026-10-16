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
  // The list fetches everything loaded so far in one go (`pages * MAIL_PAGE_SIZE`), so the cap is higher
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** `folder` searches the current mailbox, `all` every folder of the account (index only) */
  scope: z.enum(['folder', 'all']).default('folder'),
  q: z.string().trim().max(200).optional(),
  unread: z.stringbool().optional(),
  flagged: z.stringbool().optional(),
  hasAttachment: z.stringbool().optional(),
  since: z.iso.date().optional(),
  before: z.iso.date().optional(),
  from: z.string().trim().max(200).optional()
})

/** Same criteria as the message list, without paging; for filter suggestions */
export const facetsQuerySchema = messagesQuerySchema.omit({ limit: true, offset: true })

/** The provider listing cap; loading more than this needs the search index */
export const MAIL_PROVIDER_MAX_LIMIT = 200

export function getUidParam(event: RequestEvent): number {
  const result = z.coerce.number().int().positive().safeParse(getRouterParam(event, 'uid'))

  if (!result.success) {
    throw createError({ status: 400, statusText: 'Invalid message uid' })
  }

  return result.data
}
