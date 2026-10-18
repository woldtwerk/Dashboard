import type { MailAddress, MailMessage } from '../../shared/types/mail'
import { mailLink } from '../../shared/mail-source'

export interface MailNotification {
  category: 'mail-new'
  title: string
  body: string
  to: string
  domain: 'mail'
  service: string
  dedupeKey: string
}

function senderName(from: MailAddress[]): string {
  const sender = from[0]
  return sender?.name || sender?.address || 'Unknown sender'
}

/**
 * One notification per sync run and service, never per mail. `messages` are the
 * messages the INBOX gained in this run; an empty list sends nothing.
 */
export function newMailNotification(service: string, messages: MailMessage[]): MailNotification | undefined {
  if (!messages.length) {
    return undefined
  }

  const highestUid = Math.max(...messages.map(message => message.uid))
  const dedupeKey = `mail-new:${service}:${highestUid}`

  if (messages.length === 1) {
    const [message] = messages

    return {
      category: 'mail-new',
      title: senderName(message!.from),
      body: message!.subject || '(no subject)',
      to: mailLink(service, 'INBOX', message!.uid),
      domain: 'mail',
      service,
      dedupeKey
    }
  }

  return {
    category: 'mail-new',
    title: `${messages.length} new mails`,
    body: messages.slice(0, 2).map(message => senderName(message.from)).join(', '),
    to: mailLink(service, 'INBOX', highestUid),
    domain: 'mail',
    service,
    dedupeKey
  }
}
