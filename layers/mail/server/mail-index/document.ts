import { createHash } from 'node:crypto'
import { normalizeEmail } from '../../../core/shared/entities'
import type { MailAddress, MailMessage, MailSearch } from '../../shared/types/mail'

/** Indexed form of a message; search engine agnostic */
export interface MailDocument {
  id: string
  service: string
  mailbox: string
  uid: number
  /** Same mail in several folders/labels shares it; used to deduplicate results */
  messageId: string
  subject: string
  /** Searchable sender line, e.g. "Alice <alice@example.com>" */
  fromText: string
  /** Lowercase names, addresses and domains of the senders, for exact filters */
  fromTerms: string[]
  fromList: MailAddress[]
  toList: MailAddress[]
  ccList: MailAddress[]
  /** Normalized addresses of from, to and cc, so one filter finds every participant */
  participantTerms: string[]
  toText: string
  /** Unix seconds */
  date: number
  unread: boolean
  flagged: boolean
  /** Only from indexed bodies; listing an envelope does not reveal attachments */
  hasAttachment: boolean
  text: string
}

/** Long enough for search, short enough to keep the index small */
export const MAX_TEXT_LENGTH = 20_000

/** Engine-safe id ([a-zA-Z0-9-_]) that stays stable for the same message */
export function mailDocumentId(service: string, mailbox: string, uid: number): string {
  const mailboxKey = createHash('sha1').update(mailbox).digest('hex').slice(0, 12)
  return `${service}-${mailboxKey}-${uid}`
}

const formatAddress = ({ name, address }: MailAddress) => name && address ? `${name} <${address}>` : name || address || ''

export function senderTerms(addresses: MailAddress[]): string[] {
  const terms = new Set<string>()

  for (const { name, address } of addresses) {
    for (const word of (name ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (word) terms.add(word)
    }

    const email = address?.toLowerCase()
    const domain = email?.split('@')[1]
    if (email) terms.add(email)
    if (domain) {
      terms.add(domain)
      // "stripe" for stripe.com and mail.stripe.com
      const labels = domain.split('.')
      if (labels.length >= 2) terms.add(labels.at(-2)!)
    }
  }

  return [...terms]
}

/** Normalizes a sender filter the same way as the indexed terms */
export function normalizeSenderTerm(from: string): string {
  return from.trim().toLowerCase().replace(/^@/, '')
}

/** The normalized addresses of everyone on the mail, deduplicated */
export function participantTerms(addresses: MailAddress[]): string[] {
  const terms = new Set<string>()

  for (const { address } of addresses) {
    const email = normalizeEmail(address)
    if (email) terms.add(email)
  }

  return [...terms]
}

export function toMailDocument(service: string, mailbox: string, message: MailMessage): MailDocument {
  const id = mailDocumentId(service, mailbox, message.uid)

  return {
    id,
    service,
    mailbox,
    uid: message.uid,
    messageId: message.messageId || id,
    subject: message.subject,
    fromText: message.from.map(formatAddress).join(', '),
    fromTerms: senderTerms(message.from),
    fromList: message.from,
    toList: message.to,
    ccList: message.cc,
    participantTerms: participantTerms([...message.from, ...message.to, ...message.cc]),
    toText: [...message.to, ...message.cc].map(formatAddress).join(', '),
    date: Math.floor(new Date(message.date).getTime() / 1000),
    unread: message.unread,
    flagged: message.flagged,
    hasAttachment: message.hasAttachment ?? false,
    text: (message.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH)
  }
}

export function hasSearchCriteria(search: MailSearch): boolean {
  return Object.values(search).some(value => value !== undefined && value !== '' && value !== false)
}
