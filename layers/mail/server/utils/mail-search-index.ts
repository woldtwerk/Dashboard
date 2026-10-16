import type { MailDocument } from '../mail-index/document'
import type { MailSearch, MailSummary } from '../../shared/types/mail'

export type { MailDocument }

export interface MailIndexQuery {
  services: string[]
  /** Omit to search all folders */
  mailbox?: string
  search: MailSearch
  limit: number
}

/** Port for a search engine holding indexed mail (e.g. Meilisearch) */
export interface MailSearchIndex {
  upsert(documents: MailDocument[]): Promise<void>
  updateFlags(updates: Pick<MailDocument, 'id' | 'unread' | 'flagged'>[]): Promise<void>
  remove(ids: string[]): Promise<void>
  /** All documents of a service, or of one of its mailboxes */
  removeMailbox(service: string, mailbox?: string): Promise<void>
  /** Newest first without text, by relevance with text */
  search(query: MailIndexQuery): Promise<MailSummary[]>
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
