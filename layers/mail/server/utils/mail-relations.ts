import { normalizeEmail } from '../../../core/shared/entities'
import type { MailAddress, MailMessage } from '../../shared/types/mail'

/** How a person took part in a mail, strongest first; undefined when they are not on it */
export type MailParticipation = 'from' | 'to' | 'cc'

/** A mail as the relation code sees it; a search result may omit the recipient lists */
export type MailParticipationSource = Pick<MailMessage, 'from'> & Partial<Pick<MailMessage, 'to' | 'cc'>>

function hasAddress(addresses: MailAddress[] | undefined, email: string): boolean {
  return (addresses ?? []).some(address => normalizeEmail(address.address) === email)
}

/**
 * The kind of relation a person has to a mail. A mail that reached them from
 * several roles is a sender first, then a direct recipient, then a cc.
 */
export function mailRelationKind(mail: MailParticipationSource, email: string): MailParticipation | undefined {
  const normalized = normalizeEmail(email)
  if (!normalized) {
    return undefined
  }

  if (hasAddress(mail.from, normalized)) {
    return 'from'
  }
  if (hasAddress(mail.to, normalized)) {
    return 'to'
  }
  if (hasAddress(mail.cc, normalized)) {
    return 'cc'
  }
  return undefined
}

/** The address on a mail in the shape a relation list shows it */
export function mailAddressLabel(address: MailAddress, email: string): string {
  return address.name?.trim() || email
}

/** `Name <address>` lines, as the mail list shows the senders */
export function mailAddressText(addresses: MailAddress[]): string {
  return addresses
    .map(({ name, address }) => name && address ? `${name} <${address}>` : name || address || '')
    .filter(Boolean)
    .join(', ')
}
