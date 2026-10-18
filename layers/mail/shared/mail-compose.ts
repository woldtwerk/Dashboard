import { normalizeEmail } from '../../core/shared/entities'
import { hasReplyPrefix, normalizeMailAddress, normalizeMessageId } from './mail-thread'
import type { MailAddress, MailMessage } from './types/mail'

/** A mail about to be sent; the shape the send API and the MCP tool accept. */
export interface OutgoingMail {
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  text: string
  /** Message-ID this mail answers */
  inReplyTo?: string
  /** Message-ID chain this mail belongs to, oldest first */
  references?: string[]
}

/** An empty draft, for a mail the user starts from scratch */
export function emptyOutgoingMail(): OutgoingMail {
  return { to: [], cc: [], bcc: [], subject: '', text: '' }
}

/** How a mail is started from an existing one */
export type ComposeMode = 'reply' | 'replyAll' | 'forward'

/** RFC 5322 caps a header line, and thus a subject, at 998 characters */
export const OUTGOING_SUBJECT_LIMIT = 998
/** Bodies are capped at 1 MiB */
export const OUTGOING_TEXT_LIMIT = 1024 * 1024
/** A single mail may not address more people than this */
export const OUTGOING_RECIPIENT_LIMIT = 100
/** A thread carries at most this many Message-IDs */
export const OUTGOING_REFERENCES_LIMIT = 100
/** A Message-ID header line is bounded like any other */
export const OUTGOING_MESSAGE_ID_LIMIT = 998
/** `<>`-wrapped or bare, and free of whitespace so nothing can start a new header */
export const OUTGOING_MESSAGE_ID_PATTERN = /^<?[^\s<>]+>?$/
/** A subject is a single line; a line break could inject another header */
const SUBJECT_LINE_BREAK = /[\r\n]/

/** Replaces the line breaks of a subject, so a quoted one stays one line */
export function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, ' ')
}

const FORWARD_HEADER = '---------- Forwarded message ----------'

/** `Jane Doe <jane@example.com>`, or whichever half exists */
function formatAddress(address?: MailAddress): string {
  if (address?.name && address.address) {
    return `${address.name} <${address.address}>`
  }
  return address?.name || address?.address || ''
}

function formatAddressList(list: MailAddress[]): string {
  return list.map(formatAddress).filter(Boolean).join(', ')
}

/** A stable, locale-independent date for the attribution line */
function formatDate(date: string): string {
  const parsed = new Date(date)
  return Number.isNaN(parsed.getTime()) ? date : parsed.toUTCString()
}

function senderName(original: MailMessage): string {
  return formatAddress(original.from[0]) || 'Unknown'
}

/** Appends `prefix` unless the subject already carries a reply/forward marker */
function withSubjectPrefix(subject: string, prefix: string): string {
  const trimmed = sanitizeSubject(subject).trim()
  if (hasReplyPrefix(trimmed)) {
    return trimmed
  }
  return trimmed ? `${prefix}${trimmed}` : prefix.trim()
}

/** The original text, every line quoted with `> ` */
function quotedText(text?: string): string {
  return (text ?? '').split(/\r?\n/).map(line => `> ${line}`).join('\n')
}

/** The attribution line and the quoted original, behind two blank lines */
function replyBody(original: MailMessage): string {
  const attribution = `On ${formatDate(original.date)}, ${senderName(original)} wrote:`
  return `\n\n${attribution}\n${quotedText(original.text)}`
}

/** A header block naming the original, then its text unquoted */
function forwardBody(original: MailMessage): string {
  const header = [
    FORWARD_HEADER,
    `From: ${formatAddressList(original.from)}`,
    `Date: ${formatDate(original.date)}`,
    `Subject: ${original.subject}`,
    `To: ${formatAddressList(original.to)}`
  ].join('\n')

  return `\n\n${header}\n\n${original.text ?? ''}`
}

/** Appends addresses, dropping repeats and the account's own; order is kept */
function uniqueRecipients(lists: MailAddress[][], own: ReadonlySet<string>): MailAddress[] {
  const seen = new Set<string>()
  const recipients: MailAddress[] = []

  for (const address of lists.flat()) {
    const key = normalizeMailAddress(address.address)
    if (!key || seen.has(key) || own.has(key)) {
      continue
    }
    seen.add(key)
    recipients.push(address)
  }

  return recipients
}

/** The Message-ID chain of a reply: the original's references plus its own id, deduplicated */
function replyReferences(original: MailMessage): string[] | undefined {
  const seen = new Set<string>()
  const references: string[] = []

  for (const reference of [...original.references ?? [], original.messageId]) {
    const key = normalizeMessageId(reference)
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    references.push(reference!)
  }

  return references.length ? references : undefined
}

/**
 * Starts a reply, a reply to all or a forward from one mail.
 *
 * - `reply` addresses the Reply-To, or the sender when there is none.
 * - `replyAll` adds the original recipients, minus the account's own addresses.
 * - `forward` addresses nobody, the user picks the recipients.
 *
 * A reply quotes the original behind an attribution line and threads itself via
 * `inReplyTo`/`references`; a forward keeps the original unquoted behind a
 * header block and starts no thread.
 */
export function buildReply(original: MailMessage, own: string[], mode: ComposeMode): OutgoingMail {
  const ownAddresses = new Set(own.map(normalizeEmail).filter((email): email is string => !!email))
  const replyTarget = original.replyTo?.length ? original.replyTo : original.from

  const subject = withSubjectPrefix(original.subject, mode === 'forward' ? 'Fwd: ' : 'Re: ')

  if (mode === 'forward') {
    return { to: [], cc: [], bcc: [], subject, text: forwardBody(original) }
  }

  const to = mode === 'replyAll'
    ? uniqueRecipients([replyTarget, original.to, original.cc], ownAddresses)
    : uniqueRecipients([replyTarget], ownAddresses)

  return {
    to,
    cc: [],
    bcc: [],
    subject,
    text: replyBody(original),
    inReplyTo: original.messageId,
    references: replyReferences(original)
  }
}

/** Whether a mail may be sent: it needs recipients and stays within the limits */
export type OutgoingMailValidation = { valid: true } | { valid: false, error: string }

/** Checks a mail against the limits the send API and the MCP tool enforce. */
export function validateOutgoing(mail: OutgoingMail): OutgoingMailValidation {
  const recipients = [...mail.to, ...mail.cc, ...mail.bcc]

  if (!recipients.length) {
    return { valid: false, error: 'At least one recipient is required' }
  }
  if (recipients.length > OUTGOING_RECIPIENT_LIMIT) {
    return { valid: false, error: `At most ${OUTGOING_RECIPIENT_LIMIT} recipients are allowed` }
  }
  if (recipients.some(recipient => !normalizeEmail(recipient.address))) {
    return { valid: false, error: 'Every recipient needs a valid email address' }
  }
  if (SUBJECT_LINE_BREAK.test(mail.subject)) {
    return { valid: false, error: 'The subject may not contain line breaks' }
  }
  if (mail.subject.length > OUTGOING_SUBJECT_LIMIT) {
    return { valid: false, error: `The subject may hold at most ${OUTGOING_SUBJECT_LIMIT} characters` }
  }
  if (mail.text.length > OUTGOING_TEXT_LIMIT) {
    return { valid: false, error: 'The message is too large' }
  }
  if ((mail.references?.length ?? 0) > OUTGOING_REFERENCES_LIMIT) {
    return { valid: false, error: `A thread may hold at most ${OUTGOING_REFERENCES_LIMIT} references` }
  }
  // A Message-ID with whitespace or brackets could start a new header line
  const messageIds = [...mail.inReplyTo ? [mail.inReplyTo] : [], ...mail.references ?? []]
  if (messageIds.some(id => id.length > OUTGOING_MESSAGE_ID_LIMIT || !OUTGOING_MESSAGE_ID_PATTERN.test(id))) {
    return { valid: false, error: 'A Message-ID is malformed' }
  }

  return { valid: true }
}
