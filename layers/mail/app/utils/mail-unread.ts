import type { Mailbox } from '#layers/mail/shared/types/mail'

/** Virtual folders that only repeat messages filed in a real folder */
const REPEATED_SPECIAL_USE = new Set(['\\All', '\\Flagged'])

/**
 * Whether a mailbox only repeats mail a real folder already holds: a label, or
 * a virtual folder such as "All Mail" or "Starred". The cross-folder search
 * leaves the same mailboxes out, so counting them would count a mail twice.
 */
export function isRepeatedMailbox(mailbox: Pick<Mailbox, 'label' | 'specialUse'>): boolean {
  return !!mailbox.label || REPEATED_SPECIAL_USE.has(mailbox.specialUse ?? '')
}

/** Unread mails of the account's real folders; labels and virtual folders never count */
export function countUnread(mailboxes: Mailbox[]): number {
  return mailboxes.reduce((sum, mailbox) => isRepeatedMailbox(mailbox) ? sum : sum + mailbox.unread, 0)
}
