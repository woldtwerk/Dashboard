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
}

/** Everything that narrows the result, without paging; for facet suggestions */
export type MailFacetQuery = Pick<MailIndexQuery, 'services' | 'mailbox' | 'search'>

/** A flag change merged into an already indexed document; `updateDocuments` merges the fields */
export type MailFlagUpdate = Pick<MailDocument, 'id'> & Partial<Pick<MailDocument, 'unread' | 'flagged'>>

/** Port for a search engine holding indexed mail (e.g. Meilisearch) */
export interface MailSearchIndex {
  upsert(documents: MailDocument[]): Promise<void>
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
