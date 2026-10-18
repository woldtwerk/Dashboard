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
  /** Normalized List-Id; a mailing list mail carries it */
  listId?: string
  /** Whether the mail is bulk or notification mail rather than correspondence */
  bulk?: boolean
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

/**
 * Whether a subject already opens with a reply or forward marker, so composing
 * a reply must not add a second `Re:` in front of it. A list tag such as
 * `[Security-news]` is not a marker.
 */
export function hasReplyPrefix(subject: string): boolean {
  return REPLY_PREFIX.test(subject.trim())
}

/** A Message-ID without angle brackets, lower-cased; for matching References */
export function normalizeMessageId(messageId?: string): string | undefined {
  const value = messageId?.trim().replace(/^</, '').replace(/>$/, '').trim().toLowerCase()
  return value || undefined
}

/**
 * The stream headers a mail may carry; a provider reads them from the message
 * (mailparser's `parsed.headers`, or the raw header block of a light fetch).
 * Values stay `unknown` because the header APIs differ between sources.
 */
export interface MailStreamHeaderValues {
  listId?: unknown
  listUnsubscribe?: unknown
  precedence?: unknown
  autoSubmitted?: unknown
}

export interface MailStreamFlags {
  /** Normalized List-Id (the part in `<>`, lower-cased) */
  listId?: string
  /** Human readable description in front of the List-Id, when it has one */
  listName?: string
  bulk: boolean
}

/** Sender local parts that mark automated bulk mail rather than a person */
const BULK_SENDER = /^(?:no-?reply|notifications?|newsletter|news|mailer-daemon|updates?|alerts?|info)$/i

/** A header value from mailparser or a raw block, as trimmed text */
function headerText(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const text = Array.isArray(value)
    ? value.map(item => String(item)).join(', ')
    : typeof value === 'object' && 'text' in (value as Record<string, unknown>)
      ? String((value as { text?: unknown }).text ?? '')
      : String(value)

  return text.trim() || undefined
}

/** The part of a `List-Id` in angle brackets, lower-cased (`security-news.drupal.org`) */
export function normalizeListId(value?: unknown): string | undefined {
  const text = headerText(value)
  if (!text) {
    return undefined
  }

  const id = (/<([^>]*)>/.exec(text)?.[1] ?? text).trim().toLowerCase()
  return id || undefined
}

/** The description in front of the List-Id brackets, e.g. "Drupal Security News" */
export function listIdName(value?: unknown): string | undefined {
  const text = headerText(value)
  const match = text && /^(.*?)<[^>]*>\s*$/.exec(text)
  const name = match?.[1]?.replace(/^"(.*)"$/, '$1').trim()

  return name || undefined
}

/**
 * Reads the stream headers out of a raw header block, e.g. the `headers` Buffer
 * a light IMAP fetch returns. Folded continuation lines are joined, so a header
 * split across lines is read whole.
 */
export function parseRawStreamHeaders(raw: string): MailStreamHeaderValues {
  const collected = new Map<string, string>()
  let name: string | undefined

  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^[ \t]/.test(line) && name) {
      collected.set(name, `${collected.get(name) ?? ''} ${line.trim()}`)
      continue
    }

    const match = /^([^:\s]+):[ \t]?(.*)$/.exec(line)
    if (!match) {
      name = undefined
      continue
    }

    name = match[1]!.toLowerCase()
    collected.set(name, match[2] ?? '')
  }

  return {
    listId: collected.get('list-id'),
    listUnsubscribe: collected.get('list-unsubscribe'),
    precedence: collected.get('precedence'),
    autoSubmitted: collected.get('auto-submitted')
  }
}

/**
 * The stream headers of a mail: the list it belongs to, and whether it looks
 * like bulk mail. A mailing list mail is known by its `List-Id`; without one, a
 * newsletter is recognized by `List-Unsubscribe`, a bulk `Precedence`, an
 * `Auto-Submitted` other than `no`, or a machine sender address.
 */
export function mailStreamFlags(from: MailAddress[], headers: MailStreamHeaderValues): MailStreamFlags {
  const precedence = headerText(headers.precedence)?.toLowerCase()
  const autoSubmitted = headerText(headers.autoSubmitted)?.toLowerCase()
  const local = normalizeMailAddress(from[0]?.address)?.split('@')[0]

  const bulk = headerText(headers.listUnsubscribe) !== undefined
    || precedence === 'bulk' || precedence === 'list' || precedence === 'junk'
    || (autoSubmitted !== undefined && autoSubmitted !== 'no')
    || (!!local && BULK_SENDER.test(local))

  return {
    listId: normalizeListId(headers.listId),
    listName: listIdName(headers.listId),
    bulk
  }
}

/**
 * The stream key of a mail: `list:<List-Id>` when it belongs to a mailing list,
 * otherwise `from:<sender>` when it is bulk mail. A personal mail has none, so
 * normal correspondence is never merged per person.
 */
export function streamConversationKey(message: Pick<MailThreadSource, 'from' | 'listId' | 'bulk'>): string | undefined {
  const listId = normalizeListId(message.listId)
  if (listId) {
    return `list:${listId}`
  }

  if (!message.bulk) {
    return undefined
  }

  const sender = normalizeMailAddress(message.from[0]?.address)
  return sender ? `from:${sender}` : undefined
}

/** Whether a conversation key identifies a stream rather than a reply thread */
export function isStreamKey(key: string): boolean {
  return key.startsWith('list:') || key.startsWith('from:')
}

/**
 * The display name of a stream conversation: the List-Id description when the
 * provider kept one, otherwise the sender's display name or address.
 */
export function streamLabel(message: Pick<MailThreadSource, 'from'> & { listName?: string }): string {
  return message.listName?.trim() || message.from[0]?.name?.trim() || message.from[0]?.address || 'Unknown'
}

/** How an opened conversation is shown: as chat bubbles or as a list of cards */
export function conversationKind(group: Pick<MailConversationGroup, 'key'>): 'thread' | 'stream' {
  return isStreamKey(group.key) ? 'stream' : 'thread'
}

/**
 * The keys a message belongs to. A reply carries `id:<root Message-ID>` of the
 * thread's first reference; a mail that starts a thread carries the subject key
 * (which groups recurring notifications of one sender) plus `id:<own Message-ID>`,
 * so the replies that point at it join the same conversation. A mailing list or
 * bulk mail also carries its stream key, which groups a whole list into one thread.
 */
export function conversationKeys(message: MailThreadSource): string[] {
  const rootId = normalizeMessageId(message.references?.[0]) ?? normalizeMessageId(message.inReplyTo)
  const keys: string[] = []

  if (rootId) {
    keys.push(`id:${rootId}`)
  } else {
    const sender = normalizeMailAddress(message.from[0]?.address) ?? ''
    keys.push(`subj:${sender}:${normalizeSubject(message.subject)}`)

    const ownId = normalizeMessageId(message.messageId)
    if (ownId) {
      keys.push(`id:${ownId}`)
    }
  }

  const streamKey = streamConversationKey(message)
  if (streamKey) {
    keys.push(streamKey)
  }

  return keys
}

/**
 * The stored keys plus the mail's stream key, or `undefined` when the key is
 * already there (so a resumed backfill does no work twice).
 */
export function mergeStreamKeys(keys: string[], streamKey?: string): string[] | undefined {
  if (!streamKey || keys.includes(streamKey)) {
    return undefined
  }

  return [...keys, streamKey]
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
 * (union-find). The group key is the smallest shared key, or the smallest
 * stream key when the group is a mailing list or a bulk stream, so it stays
 * stable whichever mail is seen first.
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
      const sortedKeys = [...keys].sort()

      return {
        // A stream key wins, so a list thread stays one conversation even when a
        // reply only joins it through its root id
        key: sortedKeys.find(isStreamKey) ?? sortedKeys[0]!,
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
