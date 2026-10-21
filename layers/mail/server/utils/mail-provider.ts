import { createError } from 'nuxt/server'
import type { SetupValues } from '../../../core/shared/types/setup'
import type { OutgoingMail } from '../../shared/mail-compose'
import type { MailAddress, MailAttachment, Mailbox, MailMessage, MailMessageState, MailSearch, MailStreamHeader, MailSummary } from '../../shared/types/mail'

/** What removing label copies from one mailbox did */
export interface MailLabelRemoval {
  /** UIDs of the copies deleted in the label folder */
  removed: number[]
  /** Source UIDs without a Message-ID or without a copy under the label */
  unresolved: number[]
}

/** Port every mail provider adapter implements. */
export interface MailProvider {
  listMailboxes(): Promise<Mailbox[]>
  /** Newest first; `offset` pages through the result, `search` narrows it server-side */
  listMessages(mailbox: string, options: { limit: number, offset?: number, search?: MailSearch }): Promise<MailSummary[]>
  getMessage(mailbox: string, uid: number): Promise<MailMessage | null>
  setSeen(mailbox: string, uid: number, seen: boolean): Promise<void>
  /** Sets the seen flag on several messages with one provider command */
  setSeenMany(mailbox: string, uids: number[], seen: boolean): Promise<void>
  setFlagged(mailbox: string, uid: number, flagged: boolean): Promise<void>
  /**
   * Moves one message to another mailbox; the target must already exist. The
   * result carries the message's UID in the target where the server reports one
   * (IMAP UIDPLUS); without it the caller can only announce the move.
   */
  moveMessage(mailbox: string, uid: number, target: string): Promise<{ uid?: number }>
  /**
   * Moves several messages in one command. The map is old uid → uid in the
   * target, holding only the uids the server reported (IMAP UIDPLUS); without an
   * entry the caller can only announce the move.
   */
  moveMessages(mailbox: string, uids: number[], target: string): Promise<Map<number, number>>
  /** Marks one message `\Deleted` and expunges it, without touching the others */
  deleteMessage(mailbox: string, uid: number): Promise<void>
  /** Marks several messages `\Deleted` and expunges them with one command */
  deleteMessages(mailbox: string, uids: number[]): Promise<void>
  /**
   * Files a copy of one message under one label. Proton keeps labels as IMAP
   * folders under `Labels/`, which repeat mail stored in a real folder, so this is
   * a copy (the original stays) rather than a move. The result carries the copy's
   * UID where the server reports one. The batch form with a single uid, so both
   * paths cannot drift apart.
   */
  addLabel(mailbox: string, uid: number, label: string): Promise<{ uid?: number }>
  /**
   * Files copies of several messages under one label with one command, creating
   * the label folder first. The map is old uid → uid of the copy in the label
   * folder, holding only the uids the server reported (IMAP UIDPLUS).
   */
  addLabels(mailbox: string, uids: number[], label: string): Promise<Map<number, number>>
  /**
   * Removes the label copies of several messages. When `mailbox` already is the
   * label folder the copies are deleted there; from a real folder they are found
   * by Message-ID in `Labels/<label>`. `removed` holds the deleted uids in the
   * label folder; `unresolved` holds the source uids that had no Message-ID or
   * no copy under the label, so the caller can put their label back.
   */
  removeLabels(mailbox: string, uids: number[], label: string): Promise<MailLabelRemoval>
  /**
   * Creates an IMAP folder (e.g. the `Labels/<label>` a label is filed under).
   * Optional: a provider that creates the folder itself omits it. An existing
   * folder is not an error.
   */
  createMailbox?(path: string): Promise<void>
  /** The attachment metadata of one message, without fetching the body bytes */
  listAttachments?(mailbox: string, uid: number): Promise<MailAttachment[]>
  /**
   * Streams one attachment part. The caller must consume or cancel the stream;
   * `close()` is idempotent and releases the provider connection either way.
   * Optional: a provider that cannot stream a part omits it.
   */
  openAttachment?(mailbox: string, uid: number, part: string): Promise<{
    meta: MailAttachment
    stream: ReadableStream<Uint8Array>
    close: () => Promise<void>
    /** The mailbox's UIDVALIDITY, for a stable ETag */
    uidValidity?: string
  } | null>

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
  /**
   * The full RFC822 source of one message, so a caller can verify its DKIM
   * signature itself instead of trusting a header a relay wrote. Capped at
   * 2 MB: a larger message answers `undefined` rather than a truncated source,
   * whose signature would not verify anyway.
   */
  getRawMessage(mailbox: string, uid: number): Promise<Buffer | undefined>
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
