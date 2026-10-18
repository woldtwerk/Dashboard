import type { MailSummary } from '#layers/mail/shared/types/mail'
import { isOwnMail, stripSubjectPrefix, type OwnMailContext } from '#layers/mail/shared/mail-thread'
import { formatMailAddress, mailKey } from './mail'

/** One row of a conversation accordion; the values the component renders */
export type MailConversationItem = {
  /** The accordion value: the mail's stable key */
  value: string
  /** Subject without reply and list prefixes; the accordion's own label */
  label: string
  /** Sender shown in the header: name, address, or `me` for own mail */
  sender: string
  /** Whether the account sent this mail itself */
  isOwn: boolean
  /** One-line excerpt from the search index */
  snippet: string
}

/** Oldest first, like a mail client reads a thread; a stable sort keeps equal dates */
function oldestFirst(mails: MailSummary[]): MailSummary[] {
  return [...mails].sort((a, b) => a.date.localeCompare(b.date))
}

/** The mails of a conversation as accordion rows, oldest first */
export function accordionItems(mails: MailSummary[], own: OwnMailContext = {}): MailConversationItem[] {
  return oldestFirst(mails).map((mail) => {
    const isOwn = isOwnMail(mail, own)

    return {
      value: mailKey(mail),
      label: stripSubjectPrefix(mail.subject) || '(no subject)',
      sender: isOwn ? 'me' : formatMailAddress(mail.from[0]),
      isOwn,
      snippet: mail.snippet ?? ''
    }
  })
}

/** The accordion values open when a conversation is first shown: the newest mail */
export function defaultExpanded(mails: MailSummary[]): string[] {
  const newest = oldestFirst(mails).at(-1)
  return newest ? [mailKey(newest)] : []
}
