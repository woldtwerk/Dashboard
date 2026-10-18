/** A change in a domain's data, published by its sync or write paths */
export interface DomainEvent {
  /** e.g. 'calendar', 'mail', 'contacts', 'drive', 'documents' */
  domain: string
  /** Service id the change belongs to */
  service: string
  /** changed = data changed; synced = a sync run finished; sync-failed = it failed */
  type: 'changed' | 'synced' | 'sync-failed'
  /** What changed inside the service, e.g. a calendar URL or a mailbox path */
  resource?: string
  /** ISO timestamp, set by publishDomainEvent */
  at: string
}
