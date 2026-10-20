import type { MailSearch } from '../../shared/types/mail'

/** Validated query fields that narrow a search; `q` is the full text part */
export interface MailSearchQuery {
  q?: string
  unread?: boolean
  flagged?: boolean
  hasAttachment?: boolean
  label?: string
  notLabel?: string
  since?: string
  before?: string
  from?: string
}

/** Maps the query of the API endpoints onto the domain search type */
export function toMailSearch(query: MailSearchQuery): MailSearch {
  return {
    text: query.q || undefined,
    unread: query.unread,
    flagged: query.flagged,
    hasAttachment: query.hasAttachment,
    label: query.label || undefined,
    notLabel: query.notLabel || undefined,
    since: query.since,
    before: query.before,
    from: query.from || undefined
  }
}
