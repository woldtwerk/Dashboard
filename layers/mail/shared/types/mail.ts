import type { FileSourceMeta } from '../../../core/shared/types/file-sources'

export interface MailAddress {
  name?: string
  address?: string
}

export interface Mailbox {
  path: string
  name: string
  /** Hierarchy separator in `path`, e.g. "/" in "Folders/Work" */
  delimiter?: string
  specialUse?: string
  /** A label repeats mail that is also filed in a real folder; not a folder of its own */
  label?: boolean
  total: number
  unread: number
}

export interface MailSummary {
  uid: number
  /** Set on results that can span accounts, e.g. from the search index */
  service?: string
  mailbox: string
  subject: string
  /** Subject with Meilisearch match markers, from the search index */
  subjectHighlight?: string
  /** Sender line with Meilisearch match markers, from the search index */
  fromHighlight?: string
  from: MailAddress[]
  /** Recipients; only search-index results carry them, to tell how a person took part */
  to?: MailAddress[]
  cc?: MailAddress[]
  date: string
  unread: boolean
  flagged: boolean
  /** Matching excerpt with Meilisearch match markers, from the search index */
  snippet?: string
  /** Only known for indexed mail; listing a mailbox does not parse the body */
  hasAttachment?: boolean
  /**
   * Keys this mail is filed under, from the search index. Messages of one
   * conversation share at least one key, so grouping is engine-independent.
   */
  conversationKeys?: string[]
  /** Normalized List-Id (the part in `<>`, lower-cased); groups a mailing list */
  listId?: string
  /** Human readable List-Id description, e.g. "Drupal Security News" */
  listName?: string
  /** Label names the mail is filed under, from the search index */
  labels?: string[]
  /**
   * Meilisearch's `_rankingScore` (0..1) when the query asked for it; a hybrid
   * search reports the blended keyword/semantic score.
   */
  rankingScore?: number
}

/** One attachment of a mail, without its bytes */
export type MailAttachment = FileSourceMeta

export interface MailMessage extends MailSummary {
  /** RFC 5322 Message-ID; identifies the same mail in several folders/labels */
  messageId?: string
  /** Message-ID this mail answers; the root of a short thread */
  inReplyTo?: string
  /** Message-ID chain this mail belongs to, oldest first */
  references?: string[]
  /** Normalized List-Id (the part in `<>`, lower-cased); groups a mailing list */
  listId?: string
  /** Human readable List-Id description, e.g. "Drupal Security News" */
  listName?: string
  /**
   * Whether the mail looks like bulk or notification mail rather than personal
   * correspondence: List-Unsubscribe, a bulk Precedence, an Auto-Submitted
   * other than `no`, or a machine sender such as `no-reply@`.
   */
  bulk?: boolean
  to: MailAddress[]
  cc: MailAddress[]
  /** Reply-To header; a reply goes here instead of the From address */
  replyTo?: MailAddress[]
  text?: string
  html?: string
  /** Every attachment part, including inline parts embedded in the body */
  attachments?: MailAttachment[]
}

/**
 * The stream headers of one message: enough to derive its `list:`/`from:`
 * conversation key without parsing the body. A provider returns these for the
 * backfill, which only needs the headers.
 */
export interface MailStreamHeader {
  uid: number
  /** Envelope senders; the `from:` key and the fallback label use them */
  from: MailAddress[]
  /** Normalized List-Id (the part in `<>`, lower-cased) */
  listId?: string
  /** Human readable List-Id description */
  listName?: string
  /** Whether the mail looks like bulk or notification mail */
  bulk: boolean
}

/** One mail conversation as the list shows it, without the individual mails */
export interface MailConversation {
  /** Stable key of the group; the smallest shared key */
  key: string
  /** Latest mail's subject, with reply and list prefixes stripped */
  subject: string
  /** Senders taking part, in the order they appeared */
  participants: MailAddress[]
  count: number
  unread: boolean
  latest: MailSummary
}

/** A conversation including its mails, oldest first */
export interface MailConversationGroup extends MailConversation {
  mails: MailSummary[]
}

/** Server-side search; all criteria are combined (AND) */
export interface MailSearch {
  /** Full-text search in headers and body */
  text?: string
  unread?: boolean
  flagged?: boolean
  /** ISO date (YYYY-MM-DD), messages on or after */
  since?: string
  /** ISO date (YYYY-MM-DD), messages before */
  before?: string
  /** Sender name, address or domain */
  from?: string
  /** Only messages carrying an attachment; index-only, the provider cannot answer it */
  hasAttachment?: boolean
  /** Messages filed under this label */
  label?: string
  /** Messages not filed under this label; index-only, like `hasAttachment` */
  notLabel?: string
}

/** A facet value with how many matching messages carry it */
export interface MailFacetValue {
  value: string
  count: number
}

/** Filter suggestions for the current query, from the search index */
export interface MailFacets {
  /** Most frequent senders, in the normalized form the `from` filter expects */
  from: MailFacetValue[]
}

/** Flags of one message, for index sync */
export interface MailMessageState {
  uid: number
  unread: boolean
  flagged: boolean
}

/** Folders of one mail service */
export interface MailFolders {
  service: { id: string, name: string, icon?: string }
  mailboxes: Mailbox[]
  error?: string
}

/** Sync state and progress of one service's search index */
export interface MailIndexStatus {
  service: string
  /** Every indexed message, as the status tooltip reports it */
  messages: number
  /** Indexed messages of the folders the sync indexes */
  indexed: number
  /** Messages the provider reports for those folders; null until a sync listed them */
  total: number | null
  complete: boolean
  syncing: boolean
  /** Folder the running sync is working on */
  mailbox?: string
  syncedAt?: string
}
