import { HIGHLIGHT_POST_TAG, HIGHLIGHT_PRE_TAG } from './mail-highlight'
import type { MailAddress, MailSummary } from './types/mail'

/** A mail as the assistant and MCP clients show it: headers, excerpt and a link. */
export interface MailSource {
  service: string
  mailbox: string
  uid: number
  subject: string
  from: string
  date: string
  unread: boolean
  snippet?: string
  /** Opens the mail on the mail page */
  link: string
}

export const formatAddresses = (addresses: MailAddress[]) =>
  addresses.map(({ name, address }) => name && address ? `${name} <${address}>` : name || address || '').join(', ')

export const mailLink = (service: string, mailbox: string, uid: number) =>
  `/mail?${new URLSearchParams({ service, mailbox, uid: String(uid) })}`

/** The index marks matches for the UI; consumers should read plain text */
const stripHighlights = (value?: string) =>
  value?.replaceAll(HIGHLIGHT_PRE_TAG, '').replaceAll(HIGHLIGHT_POST_TAG, '')

export function toMailSource(service: string, mail: MailSummary): MailSource {
  return {
    service,
    mailbox: mail.mailbox,
    uid: mail.uid,
    subject: mail.subject || '(no subject)',
    from: formatAddresses(mail.from),
    date: mail.date,
    unread: mail.unread,
    snippet: stripHighlights(mail.snippet),
    link: mailLink(service, mail.mailbox, mail.uid)
  }
}
