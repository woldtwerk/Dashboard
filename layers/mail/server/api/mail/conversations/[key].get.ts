import { defineEventHandler, getRouterParam, getValidatedQuery, setResponseStatus } from 'nuxt/server'
import type { MailSummary } from '../../../../shared/types/mail'

/** How many mails one conversation may return, across all folders */
const CONVERSATION_MAIL_LIMIT = 200

/** The route key is URL-encoded, so a subject may hold spaces, slashes and colons */
function decodeKey(raw?: string): string {
  if (!raw) {
    return ''
  }

  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

// Every mail of one conversation, across all folders, oldest first. The group's
// other keys are resolved from the first hit, so a root and its replies that are
// only linked by the index keys come together.
export default defineEventHandler(async (event): Promise<MailSummary[] | { fallback: true }> => {
  const key = decodeKey(getRouterParam(event, 'key'))
  const { service } = await getValidatedQuery(event, serviceQuerySchema)

  const index = useMailSearchIndex()
  if (!index) {
    setResponseStatus(event, 409)
    return { fallback: true }
  }

  await requestMailSync(service)

  const first = await index.search({ services: [service], conversationKeys: [key], search: {}, limit: CONVERSATION_MAIL_LIMIT })
  const keys = new Set<string>([key])
  for (const mail of first) {
    for (const groupKey of mail.conversationKeys ?? []) {
      keys.add(groupKey)
    }
  }

  // One extra round with every key of the group; without a new key the first hits are all there is
  const mails = keys.size > 1
    ? await index.search({ services: [service], conversationKeys: [...keys], search: {}, limit: CONVERSATION_MAIL_LIMIT })
    : first

  return [...mails].sort((a, b) => a.date.localeCompare(b.date))
})
