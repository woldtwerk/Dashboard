import type { MailAddress, MailConversationGroup, MailSummary } from './types/mail'

/**
 * The headers a conversation key is derived from. A search hit only carries the
 * keys the index stored, so {@link groupConversations} prefers those and falls
 * back to this shape for provider results.
 */
export interface MailThreadSource {
  subject: string
  from: MailAddress[]
  messageId?: string
  inReplyTo?: string
  references?: string[]
  conversationKeys?: string[]
}

/** Reply and forward markers, with an optional count such as `Re[2]:` */
const REPLY_PREFIX = /^(?:(?:re|aw|fwd|fw|wg|wtr|antw)\s*(?:\[\d+\])?\s*:\s*)+/i

/** A leading bracketed list tag; it must hold a letter, so `[123]` stays a number */
const LIST_TAG = /^\[[^\]]*[a-z][^\]]*\]\s*/i

/** Canonical form of an address for comparison: lower-cased, without brackets */
export function normalizeMailAddress(address?: string): string | undefined {
  const value = address?.trim().replace(/^</, '').replace(/>$/, '').trim().toLowerCase()
  return value || undefined
}

/** `Re: [Security-news] Re[2]: Subject` → `Subject`; whitespace collapsed, case kept */
export function stripSubjectPrefix(subject: string): string {
  let value = subject.trim()

  for (;;) {
    const stripped = value.replace(REPLY_PREFIX, '').replace(LIST_TAG, '')
    if (stripped === value) {
      break
    }
    value = stripped
  }

  return value.replace(/\s+/g, ' ').trim()
}

/** The comparison form of a subject; reply prefixes, list tags and case removed */
export function normalizeSubject(subject: string): string {
  return stripSubjectPrefix(subject).toLowerCase()
}

/** A Message-ID without angle brackets, lower-cased; for matching References */
export function normalizeMessageId(messageId?: string): string | undefined {
  const value = messageId?.trim().replace(/^</, '').replace(/>$/, '').trim().toLowerCase()
  return value || undefined
}

/**
 * The keys a message belongs to. A reply carries `id:<root Message-ID>` of the
 * thread's first reference; a mail that starts a thread carries the subject key
 * (which groups recurring notifications of one sender) plus `id:<own Message-ID>`,
 * so the replies that point at it join the same conversation.
 */
export function conversationKeys(message: MailThreadSource): string[] {
  const rootId = normalizeMessageId(message.references?.[0]) ?? normalizeMessageId(message.inReplyTo)

  if (rootId) {
    return [`id:${rootId}`]
  }

  const sender = normalizeMailAddress(message.from[0]?.address) ?? ''
  const keys = [`subj:${sender}:${normalizeSubject(message.subject)}`]
  const ownId = normalizeMessageId(message.messageId)

  if (ownId) {
    keys.push(`id:${ownId}`)
  }

  return keys
}

/** The keys of a search hit; the index stored them, provider results derive them */
function keysOf(mail: MailThreadSource): string[] {
  return mail.conversationKeys?.length ? mail.conversationKeys : conversationKeys(mail)
}

const byDate = (a: Pick<MailSummary, 'date'>, b: Pick<MailSummary, 'date'>) => a.date.localeCompare(b.date)

/** Senders of a conversation, deduplicated, in the order they first appeared */
function participantsOf(mails: MailSummary[]): MailAddress[] {
  const seen = new Set<string>()
  const participants: MailAddress[] = []

  for (const mail of mails) {
    for (const address of mail.from) {
      const key = normalizeMailAddress(address.address) ?? address.name ?? ''
      if (!key || seen.has(key)) {
        continue
      }
      seen.add(key)
      participants.push(address)
    }
  }

  return participants
}

/**
 * Groups mails into conversations by uniting every pair that shares a key
 * (union-find). The group key is the smallest shared key, so it stays stable
 * whichever mail is seen first.
 */
export function groupConversations(mails: MailSummary[]): MailConversationGroup[] {
  const parent = new Map<string, string>()

  const find = (key: string): string => {
    const path: string[] = []
    let current = key
    while (parent.has(current) && parent.get(current) !== current) {
      path.push(current)
      current = parent.get(current)!
    }
    for (const node of path) {
      parent.set(node, current)
    }
    return current
  }

  const union = (a: string, b: string) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) {
      parent.set(rootA, rootB)
    }
  }

  const mailKeys = mails.map(keysOf)

  for (const keys of mailKeys) {
    for (const key of keys) {
      if (!parent.has(key)) {
        parent.set(key, key)
      }
    }
    for (let index = 1; index < keys.length; index++) {
      union(keys[0]!, keys[index]!)
    }
  }

  const groups = new Map<string, { keys: Set<string>, mails: MailSummary[] }>()

  mails.forEach((mail, index) => {
    const root = find(mailKeys[index]![0]!)
    const group = groups.get(root) ?? { keys: new Set<string>(), mails: [] }
    for (const key of mailKeys[index]!) {
      group.keys.add(key)
    }
    group.mails.push(mail)
    groups.set(root, group)
  })

  return [...groups.values()]
    .map(({ keys, mails: groupMails }) => {
      const sorted = [...groupMails].sort(byDate)
      const latest = sorted[sorted.length - 1]!

      return {
        key: [...keys].sort()[0]!,
        subject: stripSubjectPrefix(latest.subject) || '(no subject)',
        participants: participantsOf(sorted),
        mails: sorted,
        latest,
        count: sorted.length,
        unread: sorted.some(mail => mail.unread)
      }
    })
    .sort((a, b) => byDate(b.latest, a.latest) || a.key.localeCompare(b.key))
}

/** A line that opens a quoted block, or the attribution line above one */
const QUOTE_LINE = /^\s*>/
const QUOTE_ATTRIBUTION = /^(?:on\b.*\bwrote:)\s*$|^(?:am\b.*\bschrieb\b.*:)\s*$/i

export interface QuotedMailText {
  /** The fresh part of the mail */
  body: string
  /** Everything from the first quote marker on, absent when nothing is quoted */
  quoted?: string
}

/** Splits a plain-text mail into its fresh body and the quoted history behind it */
export function splitQuoted(text?: string): QuotedMailText {
  if (!text) {
    return { body: '' }
  }

  const lines = text.split(/\r?\n/)
  const index = lines.findIndex(line => QUOTE_LINE.test(line) || QUOTE_ATTRIBUTION.test(line))

  if (index < 0) {
    return { body: text.trim() }
  }

  return {
    body: lines.slice(0, index).join('\n').replace(/\s+$/, ''),
    quoted: lines.slice(index).join('\n').trim() || undefined
  }
}

export interface OwnMailContext {
  /** The account's own address, from the service setup */
  ownAddress?: string
  /** Mailbox paths that hold the account's own sent mail (special-use `\Sent`) */
  sentMailboxes?: string[]
}

/** Whether a mail is one the account sent itself: from the own address, or filed in Sent */
export function isOwnMail(mail: Pick<MailSummary, 'from' | 'mailbox'>, own: OwnMailContext = {}): boolean {
  const address = normalizeMailAddress(own.ownAddress)

  if (address && mail.from.some(sender => normalizeMailAddress(sender.address) === address)) {
    return true
  }

  return (own.sentMailboxes ?? []).includes(mail.mailbox)
}

/** How a participant is shown in a conversation; own address becomes "me" */
export function conversationParticipantLabel(address: MailAddress, ownAddress?: string): string {
  const email = normalizeMailAddress(address.address)

  if (email && email === normalizeMailAddress(ownAddress)) {
    return 'me'
  }

  return address.name?.trim() || address.address || 'Unknown'
}
