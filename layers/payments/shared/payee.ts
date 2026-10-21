/**
 * Reading the stored payee settings.
 *
 * The connector writes the current keys, but a service set up before the
 * payee gained scanned PayPal and Wero values still carries the old ones: a
 * `paypalMe` name and a free-text Wero alias (phone number or email). Reading
 * normalizes them here, so the rest of the domain sees one shape without a
 * migration of the encrypted service values.
 */

import { normalizeIban } from './iban'
import { isValidPaypalTarget, normalizePaypalHandle } from './paypal'
import type { PayeeDetails } from './types/payments'
import { isValidWeroToken } from './wero'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** A value that ends up on a single line of a mail or a QR. */
function line(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

/**
 * The payee settings out of the stored service values.
 *
 * Empty and unusable values are dropped rather than passed on: an arbitrary
 * string must never become a link, and a Wero alias from before the QR field
 * is not a share token. The IBAN is normalized but not validated — `usePayee`
 * refuses an invalid one, because a GiroCode built from it could not be paid.
 *
 * @param values
 *   The decrypted service values.
 */
export function payeeFromValues(values: Record<string, unknown>): PayeeDetails {
  const iban = normalizeIban(text(values.iban))
  const bic = text(values.bic).toUpperCase()
  const paypal = normalizePaypalHandle(text(values.paypal) || text(values.paypalMe))
  const wero = text(values.wero)

  return {
    holder: line(text(values.holder)),
    ...(iban ? { iban } : {}),
    ...(iban && bic ? { bic } : {}),
    ...(paypal && isValidPaypalTarget(paypal) ? { paypal } : {}),
    ...(wero && isValidWeroToken(wero) ? { wero } : {}),
    mailService: text(values.mailService)
  }
}
