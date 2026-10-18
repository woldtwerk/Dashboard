import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import type { MailSummary } from '../../../shared/types/mail'
import { compareImportantMails, rankImportantMails, toImportantMail, MAIL_IMPORTANCE_SCAN_LIMIT } from '../../../shared/mail-importance'
import { dashboardStorage } from '../../../../core/server/utils/dashboard'
import { knownAddresses } from '../../../../core/server/utils/relations'
import { mailOwnAddresses } from '../../utils/mail-identity'
import { MAIL_PROVIDER_MAX_LIMIT } from '../../utils/mail-schema'
import type { MailImportanceContext, RankedImportantMail } from '../../../shared/mail-importance'

const importantQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(8)
})

const CONTACTS_CACHE_KEY = 'mail:important:contacts'
const CONTACTS_TTL_SECONDS = 5 * 60

/** Contact addresses change rarely; every cluster worker reads them from shared storage */
async function contactAddresses(): Promise<ReadonlySet<string>> {
  const storage = dashboardStorage()
  try {
    const cached = await storage.getItem<string[]>(CONTACTS_CACHE_KEY)
    if (cached) {
      return new Set(cached)
    }
  } catch {
    // Without the cache the addresses are read from the provider again
  }

  const addresses = await knownAddresses()
  try {
    await storage.setItem(CONTACTS_CACHE_KEY, addresses, { ttl: CONTACTS_TTL_SECONDS })
  } catch {
    // Best effort: a cache write never makes the request fail
  }
  return new Set(addresses)
}

/** The newest unread inbox mails, from the index when it is complete, else the provider */
async function unreadInbox(service: string): Promise<MailSummary[]> {
  await requestMailSync(service)

  const index = useMailSearchIndex()
  if (index && await isMailboxIndexed(service, 'INBOX')) {
    return index.search({
      services: [service],
      mailbox: 'INBOX',
      search: { unread: true },
      limit: MAIL_IMPORTANCE_SCAN_LIMIT
    })
  }

  return (await useMailProvider(service)).listMessages('INBOX', {
    limit: Math.min(MAIL_IMPORTANCE_SCAN_LIMIT, MAIL_PROVIDER_MAX_LIMIT),
    search: { unread: true }
  })
}

async function importantOf(service: string, contacts: ReadonlySet<string>): Promise<RankedImportantMail<MailSummary>[]> {
  const [own, mails] = await Promise.all([mailOwnAddresses(service), unreadInbox(service)])
  const ownAddresses = new Set(own)
  // An own address that is also a contact must not count as one
  const knownContacts = new Set([...contacts].filter(email => !ownAddresses.has(email)))
  const context: MailImportanceContext = { contacts: knownContacts, ownAddresses }

  return rankImportantMails(mails.map(mail => ({ ...mail, service: mail.service ?? service })), context)
}

export default defineEventHandler(async (event) => {
  const { limit } = await getValidatedQuery(event, importantQuerySchema)
  const services = await listServices('mail')
  if (!services.length) {
    return []
  }

  const contacts = await contactAddresses()

  const results = await Promise.all(services.map(async ({ id }): Promise<RankedImportantMail<MailSummary>[]> => {
    try {
      return await importantOf(id, contacts)
    } catch (error) {
      // One unreachable service must not hide the important mail of the others
      useServiceLogger('mail', id).warn('Could not collect important mail', { error: error instanceof Error ? error.message : String(error) })
      return []
    }
  }))

  return results
    .flat()
    .sort(compareImportantMails)
    .slice(0, limit)
    .map(toImportantMail)
})
