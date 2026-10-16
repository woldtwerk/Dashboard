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
  from: MailAddress[]
  date: string
  unread: boolean
  flagged: boolean
  /** Matching excerpt with Meilisearch match markers, from the search index */
  snippet?: string
  /** Only known for indexed mail; listing a mailbox does not parse the body */
  hasAttachment?: boolean
}

export interface MailMessage extends MailSummary {
  /** RFC 5322 Message-ID; identifies the same mail in several folders/labels */
  messageId?: string
  to: MailAddress[]
  cc: MailAddress[]
  text?: string
  html?: string
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
