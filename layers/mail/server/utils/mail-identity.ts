import { normalizeEmail } from '../../../core/shared/entities'
import { dashboardStorage } from '../../../core/server/utils/dashboard'
import type { MailSummary } from '../../shared/types/mail'

/** Newest sent mails whose senders count as the account's own addresses */
const ALIAS_LIMIT = 20
const OWN_ADDRESSES_TTL_SECONDS = 10 * 60
const SENT_SPECIAL_USE = '\\sent'

const cacheKey = (serviceId: string) => `mail:identity:${serviceId}`

/**
 * The mail account's own address, from the service setup. Every mail connector
 * stores its login in `user`; Proton Bridge reports the account's address there.
 */
export async function mailAccountAddress(serviceId: string): Promise<string | undefined> {
  const { values } = await getService(serviceId, 'mail')
  return normalizeEmail(typeof values.user === 'string' ? values.user : undefined)
}

/** The service's Sent mailbox, by its `\Sent` special use or its conventional path */
async function sentMailbox(serviceId: string): Promise<string | undefined> {
  const mailboxes = await (await useMailProvider(serviceId)).listMailboxes()
  const sent = mailboxes.find(mailbox => mailbox.specialUse?.toLowerCase() === SENT_SPECIAL_USE)
  return sent?.path ?? mailboxes.find(mailbox => mailbox.path.toLowerCase() === 'sent')?.path
}

/** From addresses of the newest sent mail, from the index while the mailbox is indexed */
async function sentAddresses(serviceId: string, mailbox: string): Promise<string[]> {
  const index = useMailSearchIndex()
  const messages: MailSummary[] = index && await isMailboxIndexed(serviceId, mailbox)
    ? await index.search({ services: [serviceId], mailbox, search: {}, limit: ALIAS_LIMIT })
    : await (await useMailProvider(serviceId)).listMessages(mailbox, { limit: ALIAS_LIMIT })

  return messages
    .flatMap(message => message.from.map(({ address }) => normalizeEmail(address)))
    .filter((email): email is string => !!email)
}

/**
 * Every address the account sends from: its login plus the From addresses of
 * its newest sent mail. A forwarded alias (e.g. a Gmail address arriving in
 * Proton) is filed in Sent under that alias, so it counts as own too.
 * Cached for ten minutes, since sent mail changes rarely.
 */
export async function mailOwnAddresses(serviceId: string): Promise<string[]> {
  const storage = dashboardStorage()
  try {
    const cached = await storage.getItem<string[]>(cacheKey(serviceId))
    if (cached) {
      return cached
    }
  } catch {
    // Without the cache the addresses are resolved again
  }

  const addresses = new Set<string>()
  const account = await mailAccountAddress(serviceId)
  if (account) {
    addresses.add(account)
  }

  try {
    const mailbox = await sentMailbox(serviceId)
    if (mailbox) {
      for (const email of await sentAddresses(serviceId, mailbox)) {
        addresses.add(email)
      }
    }
  } catch {
    // The aliases are best effort; the setup address always stands
  }

  const list = [...addresses]
  try {
    await storage.setItem(cacheKey(serviceId), list, { ttl: OWN_ADDRESSES_TTL_SECONDS })
  } catch {
    // Best effort: a cache write never makes the request fail
  }
  return list
}
