import { setResponseHeader } from 'h3'
import type { H3Event } from 'h3'
import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import { toCorrectionExample } from '../../../shared/automation'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5000).default(1000)
})

/**
 * The runs a user reacted to, as JSONL: one labelled example per line for a future
 * Laya fine-tune. Kept as a download, so the browser can save it directly.
 */
export default defineEventHandler(async (event) => {
  const { limit } = await getValidatedQuery(event, querySchema)
  const corrections = await listCorrections(limit)

  // Nuxt's portable RequestEvent is narrower than the h3 v1 event the runtime passes
  const h3Event = event as unknown as H3Event
  setResponseHeader(h3Event, 'content-type', 'application/x-ndjson; charset=utf-8')
  setResponseHeader(h3Event, 'content-disposition', 'attachment; filename="automation-corrections.jsonl"')

  return corrections.map(run => JSON.stringify(toCorrectionExample(run))).join('\n')
})
