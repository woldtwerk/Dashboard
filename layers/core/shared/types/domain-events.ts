/** A change in a domain's data, published by its sync or write paths */
export interface DomainEvent {
  /** e.g. 'calendar', 'mail', 'contacts', 'drive', 'documents' */
  domain: string
  /** Service id the change belongs to */
  service: string
  /**
   * What changed. `changed` = data changed, `synced` = a sync run finished,
   * `sync-failed` = it failed; a layer may publish its own lower-case type,
   * e.g. `modal` or `review` (see `DOMAIN_EVENT_TYPE_RE`).
   */
  type: string
  /** What changed inside the service, e.g. a calendar URL or a mailbox path */
  resource?: string
  /** ISO timestamp, set by publishDomainEvent */
  at: string
}
