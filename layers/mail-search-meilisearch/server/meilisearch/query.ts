import type { MailIndexQuery } from '../../../mail/server/utils/mail-search-index'
import { normalizeSenderTerm } from '../../../mail/server/mail-index/document'

/** Quotes a value for a Meilisearch filter expression */
export function filterValue(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

const unixSeconds = (isoDate: string) => Math.floor(new Date(`${isoDate}T00:00:00Z`).getTime() / 1000)

/** Meilisearch filter for a mail query; all parts are combined with AND */
export function buildMailFilter({ services, mailbox, search }: Pick<MailIndexQuery, 'services' | 'mailbox' | 'search'>): string[] {
  const filter = [`service IN [${services.map(filterValue).join(', ')}]`]

  if (mailbox) filter.push(`mailbox = ${filterValue(mailbox)}`)
  if (search.unread) filter.push('unread = true')
  if (search.flagged) filter.push('flagged = true')
  if (search.since) filter.push(`date >= ${unixSeconds(search.since)}`)
  if (search.before) filter.push(`date < ${unixSeconds(search.before)}`)
  if (search.from) filter.push(`fromTerms = ${filterValue(normalizeSenderTerm(search.from))}`)

  return filter
}
