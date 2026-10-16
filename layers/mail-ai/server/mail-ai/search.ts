import { z } from 'zod'
import type { MailSearch } from '../../../mail/shared/types/mail'

/** What the model may return for a search; mirrors MailSearch */
export const aiSearchSchema = z.object({
  text: z.string().optional().describe('Keywords for the full text search, without the parts expressed as filters. Omit when the request only filters.'),
  from: z.string().optional().describe('Sender name, address or domain, e.g. "stripe" or "alice@example.com"'),
  unread: z.boolean().optional().describe('Only unread mails'),
  flagged: z.boolean().optional().describe('Only starred mails'),
  since: z.string().optional().describe('Earliest date, YYYY-MM-DD, inclusive'),
  before: z.string().optional().describe('Date after the last day, YYYY-MM-DD, exclusive')
})

export type AiSearch = z.infer<typeof aiSearchSchema>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const isDate = (value?: string) => !!value && ISO_DATE.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
const clean = (value?: string) => value?.trim() || undefined

/** Model output is untrusted: keep only well-formed criteria */
export function normalizeAiSearch(search: AiSearch): MailSearch {
  const since = isDate(search.since) ? search.since : undefined
  const before = isDate(search.before) && (!since || search.before! > since) ? search.before : undefined

  return {
    text: clean(search.text),
    from: clean(search.from)?.slice(0, 200),
    unread: search.unread || undefined,
    flagged: search.flagged || undefined,
    since,
    before
  }
}

export function searchInstructions(today: string): string {
  return [
    'You turn a request for emails into search criteria.',
    `Today is ${today}. Resolve relative dates ("last month", "seit Montag") to absolute dates.`,
    'Use `from` for senders, `unread`/`flagged` only when asked for, and put the remaining topic words into `text`.',
    'The request may be in any language; keep `text` in the language of the request.'
  ].join('\n')
}
