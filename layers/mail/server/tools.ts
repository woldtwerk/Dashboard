import { z } from 'zod'
import type { DomainTool } from '../../core/shared/types/tools'
import type { MailSearch } from '../shared/types/mail'
import { mailLink, toMailSource } from '../shared/mail-source'

/** Mail text sent to an assistant or MCP client per message. */
export const MAIL_TOOL_TEXT_LIMIT = 20_000

export const mailSearchInput = z.object({
  service: z.string().min(1).optional().describe('Mail service id; omit to search every configured account'),
  mailbox: z.string().min(1).default('INBOX').describe('Mailbox path, e.g. "INBOX" or "Folders/Work"'),
  scope: z.enum(['folder', 'all']).default('folder').describe('"folder" searches only `mailbox`; "all" searches every folder of the account'),
  text: z.string().trim().max(200).optional().describe('Full-text search in headers and body'),
  from: z.string().trim().max(200).optional().describe('Sender name, address or domain, e.g. "stripe" or "alice@example.com"'),
  unread: z.boolean().optional().describe('Only unread messages'),
  flagged: z.boolean().optional().describe('Only starred messages'),
  hasAttachment: z.boolean().optional().describe('Only messages with an attachment'),
  since: z.iso.date().optional().describe('Earliest message date, YYYY-MM-DD, inclusive'),
  before: z.iso.date().optional().describe('Exclusive end date, YYYY-MM-DD'),
  limit: z.number().int().min(1).max(25).default(10).describe('Maximum number of messages, at most 25')
})

export const mailReadInput = z.object({
  service: z.string().min(1).describe('Mail service id'),
  mailbox: z.string().min(1).describe('Mailbox path the message is in'),
  uid: z.number().int().positive().describe('IMAP UID of the message within its mailbox')
})

export const mailSetFlagsInput = z.object({
  service: z.string().min(1).describe('Mail service id'),
  mailbox: z.string().min(1).describe('Mailbox path the message is in'),
  uid: z.number().int().positive().describe('IMAP UID of the message within its mailbox'),
  seen: z.boolean().optional().describe('Mark the message read (true) or unread (false)'),
  flagged: z.boolean().optional().describe('Star (true) or unstar (false) the message')
}).refine(input => input.seen !== undefined || input.flagged !== undefined, 'Set seen, flagged or both')

export const mailMoveInput = z.object({
  service: z.string().min(1).describe('Mail service id'),
  mailbox: z.string().min(1).describe('Mailbox path the message is currently in'),
  uid: z.number().int().positive().describe('IMAP UID of the message within its mailbox'),
  target: z.string().min(1).describe('Destination mailbox path, e.g. "Archive" or "Folders/Work"')
})

/** Maps tool input onto the domain search type; only well-formed criteria survive. */
export function toMailToolSearch(input: z.infer<typeof mailSearchInput>): MailSearch {
  return {
    text: input.text || undefined,
    from: input.from || undefined,
    unread: input.unread || undefined,
    flagged: input.flagged || undefined,
    hasAttachment: input.hasAttachment || undefined,
    since: input.since,
    before: input.before
  }
}

async function searchService(service: string, input: z.infer<typeof mailSearchInput>) {
  const criteria = toMailToolSearch(input)
  const index = useMailSearchIndex()
  const allFolders = input.scope === 'all'
  const mailbox = allFolders ? undefined : input.mailbox
  // A cross-folder search only covers real folders, so labels and virtual
  // folders do not list the same mail twice
  const mailboxes = index && allFolders ? searchableMailboxes(await (await useMailProvider(service)).listMailboxes()) : undefined

  if (index && await isMailboxIndexed(service, allFolders ? mailboxes : mailbox)) {
    const mails = await index.search({ services: [service], mailbox, mailboxes, search: criteria, limit: input.limit })
    return mails.map(mail => toMailSource(service, mail))
  }

  // Without a complete index the provider serves the current folder, like the mail page
  const mails = await (await useMailProvider(service)).listMessages(input.mailbox, { limit: input.limit, search: criteria })
  return mails.map(mail => toMailSource(service, mail))
}

async function searchMail(input: z.infer<typeof mailSearchInput>) {
  const services = input.service ? [input.service] : (await listServices('mail')).map(service => service.id)
  const results = []

  for (const service of services) {
    try {
      results.push(...await searchService(service, input))
    } catch (error) {
      // One unreachable account must not hide the others
      if (input.service) {
        throw error
      }
      useServiceLogger('mail', service).warn('Tool search failed', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    results: results.sort((a, b) => b.date.localeCompare(a.date)).slice(0, input.limit)
  }
}

const addresses = (list: { name?: string, address?: string }[]) =>
  list.map(({ name, address }) => name && address ? `${name} <${address}>` : name || address || '').join(', ')

async function readMail(input: z.infer<typeof mailReadInput>) {
  const message = await (await useMailProvider(input.service)).getMessage(input.mailbox, input.uid)
  if (!message) {
    return { error: 'Mail not found' }
  }

  return {
    service: input.service,
    mailbox: input.mailbox,
    uid: message.uid,
    subject: message.subject,
    from: addresses(message.from),
    to: addresses([...message.to, ...message.cc]),
    date: message.date,
    text: (message.text ?? '').slice(0, MAIL_TOOL_TEXT_LIMIT),
    link: mailLink(input.service, input.mailbox, message.uid)
  }
}

async function listFolders(service: string | undefined) {
  const services = service ? [service] : (await listServices('mail')).map(item => item.id)

  return Promise.all(services.map(async (id) => {
    try {
      return { service: id, mailboxes: await (await useMailProvider(id)).listMailboxes() }
    } catch (error) {
      return { service: id, mailboxes: [], error: error instanceof Error ? error.message : 'Unavailable' }
    }
  }))
}

export const mailTools: DomainTool[] = [
  {
    name: 'mail_search',
    domain: 'mail',
    description: 'Search mail across all accounts or one account. Returns the newest matching messages with subject, sender, date, excerpt and a link. At most 25 results; use mail_read for the full text.',
    input: mailSearchInput,
    writes: false,
    execute: async input => await searchMail(input as z.infer<typeof mailSearchInput>)
  },
  {
    name: 'mail_read',
    domain: 'mail',
    description: 'Read one mail by service, mailbox and UID. Returns the headers (subject, from, to, date) and the plain text, cut at 20 000 characters. Attachments are not included.',
    input: mailReadInput,
    writes: false,
    execute: async input => await readMail(input as z.infer<typeof mailReadInput>)
  },
  {
    name: 'mail_list_folders',
    domain: 'mail',
    description: 'List the mailboxes of the configured accounts with message and unread counts. Omit `service` to list every account.',
    input: z.object({
      service: z.string().min(1).optional().describe('Mail service id; omit to list every configured account')
    }),
    writes: false,
    execute: async input => await listFolders((input as { service?: string }).service)
  },
  {
    name: 'mail_set_flags',
    domain: 'mail',
    description: 'Mark one mail as read/unread or starred/unstarred. Set at least one of `seen` and `flagged`; the change applies immediately.',
    input: mailSetFlagsInput,
    writes: true,
    execute: async (raw) => {
      const input = raw as z.infer<typeof mailSetFlagsInput>
      const provider = await useMailProvider(input.service)

      if (input.seen !== undefined) {
        await provider.setSeen(input.mailbox, input.uid, input.seen)
      }
      if (input.flagged !== undefined) {
        await provider.setFlagged(input.mailbox, input.uid, input.flagged)
      }

      await publishDomainEvent({ domain: 'mail', service: input.service, type: 'changed', resource: input.mailbox })

      return { uid: input.uid, seen: input.seen, flagged: input.flagged }
    }
  },
  {
    name: 'mail_move',
    domain: 'mail',
    description: 'Move one mail to another mailbox of the same account. The target mailbox must already exist; use mail_list_folders to find its path.',
    input: mailMoveInput,
    writes: true,
    execute: async (raw) => {
      const input = raw as z.infer<typeof mailMoveInput>
      await (await useMailProvider(input.service)).moveMessage(input.mailbox, input.uid, input.target)
      await publishDomainEvent({ domain: 'mail', service: input.service, type: 'changed', resource: input.mailbox })
      await publishDomainEvent({ domain: 'mail', service: input.service, type: 'changed', resource: input.target })

      return { uid: input.uid, from: input.mailbox, to: input.target }
    }
  }
]
