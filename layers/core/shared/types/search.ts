/** One result of the global search (Ctrl+K), as the palette renders it. */
export interface SearchHit {
  /** Entity key of the hit, e.g. `mail:svc:INBOX/1`; see `shared/entities` */
  ref: string
  title: string
  /** Title with highlight markers, when the provider matched inside it */
  titleHighlight?: string
  /** Excerpt with highlight markers */
  snippet?: string
  /** One-line context under the title, e.g. the sender or the calendar */
  subtitle?: string
  /** Page that opens the hit */
  to: string
  /** ISO 8601 of the moment the hit belongs to, e.g. a mail date */
  date?: string
}

/** Hits of one provider, ready to be rendered as a command palette group. */
export interface SearchGroup {
  domain: string
  label: string
  icon?: string
  hits: SearchHit[]
}
