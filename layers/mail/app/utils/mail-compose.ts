import { normalizeEmail } from '#layers/core/shared/entities'
import type { OutgoingMail } from '#layers/mail/shared/mail-compose'
import type { MailAddress } from '#layers/mail/shared/types/mail'

/** The fields the composer edits, with recipients still as tag strings */
export interface MailComposeDraft {
  /** The account address the mail is sent from */
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
}

/** `Jane Doe <jane@example.com>` for a tag input, or whichever half exists */
export function formatMailAddressTag(address: MailAddress): string {
  if (address.name && address.address) {
    return `${address.name} <${address.address}>`
  }
  return address.address || address.name || ''
}

/** One tag string back into an address; a display name is kept when it is not the address */
export function parseMailAddress(value: string): MailAddress {
  const address = normalizeEmail(value)
  const name = value.replace(/<[^<>]*>\s*$/, '').replace(/^["']|["']$/g, '').trim()

  return { name: name && name !== address ? name : undefined, address: address ?? value.trim() }
}

/** The tags as addresses; a tag without an address is dropped */
export function parseMailAddresses(values: string[]): MailAddress[] {
  return values.map(parseMailAddress).filter(address => !!address.address)
}

/** The tags that do not hold a valid address, so the composer can flag them */
export function invalidMailAddresses(values: string[]): string[] {
  return values.filter(value => !normalizeEmail(value))
}

/** The composer's fields as an outgoing mail, ready for the send API */
export function toOutgoingMail(draft: MailComposeDraft): OutgoingMail {
  return {
    from: draft.from || undefined,
    to: parseMailAddresses(draft.to),
    cc: parseMailAddresses(draft.cc),
    bcc: parseMailAddresses(draft.bcc),
    subject: draft.subject.trim(),
    text: draft.text
  }
}
