import { createError } from 'nuxt/server'
import type { SetupValues } from '../../../core/shared/types/setup'
import type { OutgoingMail } from '../../shared/mail-compose'
import type { MailAddress, Mailbox, MailMessage, MailMessageState, MailSearch, MailStreamHeader, MailSummary } from '../../shared/types/mail'

/** Port every mail provider adapter implements. */
export interface MailProvider {
  listMailboxes(): Promise<Mailbox[]>
  /** Newest first; `offset` pages through the result, `search` narrows it server-side */
  listMessages(mailbox: string, options: { limit: number, offset?: number, search?: MailSearch }): Promise<MailSummary[]>
  getMessage(mailbox: string, uid: number): Promise<MailMessage | null>
  setSeen(mailbox: string, uid: number, seen: boolean): Promise<void>
  setFlagged(mailbox: string, uid: number, flagged: boolean): Promise<void>
  /**
   * Moves one message to another mailbox; the target must already exist. The
   * result carries the message's UID in the target where the server reports one
   * (IMAP UIDPLUS); without it the caller can only announce the move.
   */
  moveMessage(mailbox: string, uid: number, target: string): Promise<{ uid?: number }>
  /** Marks one message `\Deleted` and expunges it, without touching the others */
  deleteMessage(mailbox: string, uid: number): Promise<void>
  /**
   * Files a copy of one message under one label. Proton keeps labels as IMAP
   * folders under `Labels/`, which repeat mail stored in a real folder, so this is
   * a copy (the original stays) rather than a move. The result carries the copy's
   * UID where the server reports one; the label folder must already exist.
   */
  addLabel(mailbox: string, uid: number, label: string): Promise<{ uid?: number }>
  /**
   * Creates an IMAP folder (e.g. the `Labels/<label>` a label is filed under).
   * Optional: a provider that creates the folder itself omits it. An existing
   * folder is not an error.
   */
  createMailbox?(path: string): Promise<void>

  // --- Sending ---
  /**
   * Sends a mail through the account. Optional: a provider that cannot send
   * omits it, and the send endpoint answers 501. The provider files the mail in
   * Sent itself where the server does, so the API does not append it via IMAP.
   */
  send?(mail: OutgoingMail, from: MailAddress): Promise<{ messageId: string }>
  /**
   * Sets the `\Answered` flag on one message. Optional too: a provider that
   * keeps the flag itself (Proton Bridge marks a reply as answered on send)
   * leaves it out, and the send endpoint then skips the flag.
   */
  setAnswered?(mailbox: string, uid: number, answered: boolean): Promise<void>

  // --- Search index sync ---
  /** All messages of a mailbox with their flags; a new `uidValidity` invalidates all known UIDs */
  listMessageStates(mailbox: string): Promise<{ uidValidity: string, messages: MailMessageState[] }>
  /** Messages including their text, for indexing */
  getMessages(mailbox: string, uids: number[]): Promise<MailMessage[]>
  /**
   * The list and bulk headers of the given messages, without their bodies. Used
   * by the one-time stream backfill, which must not refetch every mail.
   */
  getStreamHeaders(mailbox: string, uids: number[]): Promise<MailStreamHeader[]>
}

/** Creates a provider from the settings of one service instance */
export type MailProviderFactory = (values: SetupValues) => MailProvider

const providers = new Map<string, MailProviderFactory>()

export function registerMailProvider(connector: string, factory: MailProviderFactory) {
  providers.set(connector, factory)
}

export async function useMailProvider(serviceId: string): Promise<MailProvider> {
  const service = await getService(serviceId, 'mail')
  const factory = providers.get(service.connector)

  if (!factory) {
    throw createError({ status: 503, statusText: `Mail provider "${service.connector}" is not available` })
  }

  return factory(service.values)
}
