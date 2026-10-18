import type { OutgoingMail } from '../../shared/mail-compose'
import { validateOutgoing } from '../../shared/mail-compose'
import type { MailAddress } from '../../shared/types/mail'
import type { MailProvider } from './mail-provider'

/** Just the logger the send needs; matches the consola instance used across the server */
export interface MailSendLogger {
  info: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
}

/** The mail a reply answers, so its `\Answered` flag can be set afterwards */
export interface MailSendReply {
  mailbox: string
  uid: number
}

/** Injected so the validate → send → answered → event sequence is testable without Nuxt */
export interface MailSendDependencies {
  provider: MailProvider
  /** The account's own address, used as the envelope sender */
  from: MailAddress
  /** Sets the `\Answered` flag on the replied-to mail; absent when the provider cannot */
  markAnswered?: (mailbox: string, uid: number) => Promise<void>
  /** Announces the new mail in Sent to the domain event stream */
  publish: () => Promise<void>
  logger: MailSendLogger
}

/** The HTTP outcome of a send; the endpoint maps it onto a status and message */
export type MailSendOutcome
  = | { status: 200, messageId: string }
    | { status: 400, error: string }
    | { status: 501, error: string }

/**
 * Sends one mail. The mail is validated first, then handed to the provider;
 * afterwards a reply marks the original as answered, the change is announced
 * and the send is logged with the recipient count only, never an address.
 * A failure to set the flag never fails the send: the mail is already out.
 */
export async function sendMail(
  mail: OutgoingMail,
  reply: MailSendReply | undefined,
  deps: MailSendDependencies
): Promise<MailSendOutcome> {
  const validation = validateOutgoing(mail)
  if (!validation.valid) {
    return { status: 400, error: validation.error }
  }

  if (!deps.provider.send) {
    return { status: 501, error: 'This mail account cannot send mail' }
  }

  const { messageId } = await deps.provider.send(mail, deps.from)

  if (reply && deps.markAnswered) {
    try {
      await deps.markAnswered(reply.mailbox, reply.uid)
    } catch (error) {
      deps.logger.warn('Could not mark the replied-to mail as answered', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  await deps.publish()
  deps.logger.info('mail sent', { recipients: mail.to.length + mail.cc.length + mail.bcc.length })

  return { status: 200, messageId }
}
