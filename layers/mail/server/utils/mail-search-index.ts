import type { MailDocument } from '../mail-index/document'
import type { MailFacets, MailSearch, MailSummary } from '../../shared/types/mail'

export type { MailDocument }

export interface MailIndexQuery {
  services: string[]
  /** Omit to search all folders */
  mailbox?: string
  /** Only these folders, e.g. all real folders of an account; omit for all */
  mailboxes?: string[]
  /** Normalized address that has to be on the mail as sender, recipient or in cc */
  participant?: string
  /** Only mails filed under one of these conversation keys */
  conversationKeys?: string[]
  search: MailSearch
  limit: number
  /** Skip this many best matches; for "load more" */
  offset?: number
  /**
   * Tunes the query for the Ctrl+K palette: a shorter body crop, the sender
   * line highlighted too, and `_rankingScore` reported. The mail page's own
   * search leaves it off.
   */
  globalSearch?: boolean
}

/** Everything that narrows the result, without paging; for facet suggestions */
export type MailFacetQuery = Pick<MailIndexQuery, 'services' | 'mailbox' | 'search'>

/** A flag change merged into an already indexed document; `updateDocuments` merges the fields */
export type MailFlagUpdate = Pick<MailDocument, 'id'> & Partial<Pick<MailDocument, 'unread' | 'flagged'>>

/** A partial document merged into an already indexed one; only the given fields change */
export type MailDocumentUpdate = Pick<MailDocument, 'id'> & Partial<Omit<MailDocument, 'id'>>

/** Port for a search engine holding indexed mail (e.g. Meilisearch) */
export interface MailSearchIndex {
  upsert(documents: MailDocument[]): Promise<void>
  /** Merges partial documents: the fields they carry replace the stored ones */
  updateDocuments(updates: MailDocumentUpdate[]): Promise<void>
  updateFlags(updates: MailFlagUpdate[]): Promise<void>
  remove(ids: string[]): Promise<void>
  /** All documents of a service, or of one of its mailboxes */
  removeMailbox(service: string, mailbox?: string): Promise<void>
  /** Newest first without text, by relevance with text */
  search(query: MailIndexQuery): Promise<MailSummary[]>
  /** Filter suggestions for the current query, e.g. the most frequent senders */
  facets(query: MailFacetQuery): Promise<MailFacets>
  /** Message counts per UTC day in [since, until); for dashboard series */
  countByDay(query: { services: string[], since: string, until: string }): Promise<{ date: string, count: number }[]>
}

let factory: (() => MailSearchIndex) | undefined
let instance: MailSearchIndex | undefined

/** Called by a search adapter layer; without one, search goes to the mail provider */
export function registerMailSearchIndex(create: () => MailSearchIndex) {
  factory = create
  instance = undefined
}

export function useMailSearchIndex(): MailSearchIndex | undefined {
  instance ??= factory?.()
  return instance
}
