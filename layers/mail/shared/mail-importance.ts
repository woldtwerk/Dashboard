import { normalizeEmail } from '../../core/shared/entities'
import type { MailAddress, MailSummary } from './types/mail'

/** Why an unread inbox mail is worth showing on the dashboard */
export type MailImportanceReason = 'flagged' | 'contact' | 'reply'

/** The badge text for each reason, strongest first */
export const MAIL_IMPORTANCE_REASON_LABELS: Record<MailImportanceReason, string> = {
  flagged: 'Starred',
  contact: 'Contact',
  reply: 'Reply'
}

const IMPORTANCE_RANK: Record<MailImportanceReason, number> = {
  flagged: 0,
  contact: 1,
  reply: 2
}

/** Everything the rule reads from a mail; a search result may omit the recipients */
export interface MailImportanceSource {
  mailbox: string
  unread: boolean
  flagged: boolean
  subject: string
  from: MailAddress[]
  to?: MailAddress[]
  date: string
}

export interface MailImportanceContext {
  /** Normalized addresses of the user's contacts */
  contacts: ReadonlySet<string>
  /** The mail account's own address, from the service setup */
  ownAddress?: string
}

export type ImportantMail = MailSummary & { reasons: string[] }
export type RankedImportantMail<T> = T & { reasons: string[], rank: number }

/** How many of the newest unread inbox mails each service contributes */
export const MAIL_IMPORTANCE_SCAN_LIMIT = 100

/** `Re:`, `AW:`, `SV:` and `Antw:` open a reply; `Fwd:` does not */
const REPLY_SUBJECT = /^\s*(?:re|aw|sv|antw)\s*:/i

function addressesOf(addresses: MailAddress[] | undefined): string[] {
  return (addresses ?? [])
    .map(({ address }) => normalizeEmail(address))
    .filter((email): email is string => !!email)
}

function isFromContact(mail: MailImportanceSource, contacts: ReadonlySet<string>): boolean {
  return addressesOf(mail.from).some(email => contacts.has(email))
}

/**
 * A mail that answers the user's own message: the setup's address is the sole
 * recipient and the subject carries a reply prefix. `In-Reply-To` is not part
 * of the mail summary yet, so the recipients are the available evidence.
 */
function isReplyToMe(mail: MailImportanceSource, ownAddress?: string): boolean {
  const own = normalizeEmail(ownAddress)
  if (!own) {
    return false
  }

  const recipients = new Set(addressesOf(mail.to))
  return recipients.size === 1 && recipients.has(own) && REPLY_SUBJECT.test(mail.subject)
}

function importanceReasonKeys(mail: MailImportanceSource, context: MailImportanceContext): MailImportanceReason[] {
  if (!mail.unread || mail.mailbox.toUpperCase() !== 'INBOX') {
    return []
  }

  const reasons: MailImportanceReason[] = []
  if (mail.flagged) {
    reasons.push('flagged')
  }
  if (isFromContact(mail, context.contacts)) {
    reasons.push('contact')
  }
  if (isReplyToMe(mail, context.ownAddress)) {
    reasons.push('reply')
  }
  return reasons
}

/** Badge text of the reasons that make this mail important; empty when it is not */
export function importanceReasons(mail: MailImportanceSource, context: MailImportanceContext): string[] {
  return importanceReasonKeys(mail, context).map(reason => MAIL_IMPORTANCE_REASON_LABELS[reason])
}

/** Lower is more important; undefined for mail the rule leaves out */
export function mailImportanceRank(mail: MailImportanceSource, context: MailImportanceContext): number | undefined {
  const ranks = importanceReasonKeys(mail, context).map(reason => IMPORTANCE_RANK[reason])
  return ranks.length ? Math.min(...ranks) : undefined
}

function timeOf(date: string): number {
  const time = new Date(date).getTime()
  return Number.isFinite(time) ? time : 0
}

/** Strongest reason first, then newest first */
export function compareImportantMails(left: { rank: number, date: string }, right: { rank: number, date: string }): number {
  return left.rank - right.rank || timeOf(right.date) - timeOf(left.date)
}

/** The mails the rule considers important, ranked and with their reason badges */
export function rankImportantMails<T extends MailImportanceSource>(
  mails: T[],
  context: MailImportanceContext
): RankedImportantMail<T>[] {
  return mails.flatMap((mail) => {
    const rank = mailImportanceRank(mail, context)
    return rank === undefined ? [] : [{ ...mail, reasons: importanceReasons(mail, context), rank }]
  }).sort(compareImportantMails)
}

/** The API shape: a ranked mail without its internal rank */
export function toImportantMail<T extends MailSummary>(mail: RankedImportantMail<T>): ImportantMail {
  const { rank: _rank, ...rest } = mail
  return rest
}
