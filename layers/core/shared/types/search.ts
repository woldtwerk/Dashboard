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
  /** Subtitle with highlight markers, when a term matched inside it */
  subtitleHighlight?: string
  /** Page that opens the hit */
  to: string
  /** ISO 8601 of the moment the hit belongs to, e.g. a mail date */
  date?: string
  /**
   * How the provider found the hit: a text match in title/from/snippet
   * ("keyword") or only through a vector search ("semantic"). Only mail can
   * report "semantic"; a provider that does not set it is a keyword hit.
   */
  match?: 'keyword' | 'semantic'
  /** Provider relevance, normalised to 0..1, e.g. Meilisearch's `_rankingScore` */
  providerScore?: number
  /** Domain the hit came from; only set on a `top` hit of `searchAll` */
  domain?: string
  /** Human readable domain label of a `top` hit, e.g. "Documents" */
  domainLabel?: string
  /** Icon of the domain the hit came from; only set on a `top` hit */
  icon?: string
}

/** Hits of one provider, ready to be rendered as a command palette group. */
export interface SearchGroup {
  domain: string
  label: string
  icon?: string
  hits: SearchHit[]
}

/** The global search across every domain: the best hits and the per-domain groups. */
export interface SearchResults {
  /** Best hits across all domains, by relevance, each carrying its domain and icon */
  top: SearchHit[]
  /** One group per domain, each sorted by relevance, ordered by their best hit */
  groups: SearchGroup[]
}
