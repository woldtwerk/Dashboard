/**
 * The PayPal side of a payment request.
 *
 * The payee stores an identifier, never a link — a PayPal.Me name or the id out
 * of a personal PayPal code. Every URL is built here, in one place, so a stored
 * value can never be rendered as a link and a payee cannot smuggle an arbitrary
 * URL into a QR that a payer then scans.
 */

import { parseHttpsUrl, pathSegments } from './payment-url'

/** A PayPal.Me name. */
const PAYPAL_HANDLE = /^[A-Za-z0-9._-]{1,64}$/

/** A PayPal personal-code id, as `p2pqrc` links carry it. */
const PAYPAL_CODE_ID = /^[A-Za-z0-9]{4,64}$/

/**
 * What a stored PayPal value is, so the link can be built the way PayPal
 * expects it.
 *
 * A `paypal.me` name and a personal-code id behave differently: only the name
 * can carry a prefilled amount, the id has to be opened as the link PayPal
 * itself minted. A bare string cannot tell the two apart on its own, so the
 * kind travels with the value.
 */
export interface PaypalTarget {
  kind: 'handle' | 'code'
  value: string
}

/**
 * The name out of a PayPal.Me name, `@name` or pasted link.
 *
 * The connector normalizes the same way, so a payee can paste a profile link
 * and the stored value stays the bare name.
 *
 * @param input
 *   What the payee typed or scanned.
 */
export function normalizePaypalHandle(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(?:www\.)?paypal\.me\//i, '')
    .replace(/^(?:www\.)?paypal\.me\//i, '')
    .replace(/^@/, '')
    .replace(/^\/+/, '')
    .split('/')[0]!
}

/**
 * Whether a stored value is a name or a code id the link builder accepts.
 *
 * @param stored
 *   The stored value, or what the payee typed before it is normalized.
 */
export function isValidPaypalTarget(stored: string): boolean {
  const value = normalizePaypalHandle(stored)

  return PAYPAL_HANDLE.test(value) || PAYPAL_CODE_ID.test(value)
}

/**
 * Reads a stored PayPal value back into its kind.
 *
 * The two shapes are told apart by form: a code id is all letters and digits,
 * a name may also carry `.`, `_` and `-`. A value that fits both is read as a
 * code, because a personal code is what PayPal's own QR carries.
 *
 * @param stored
 *   The stored value.
 */
export function parsePaypalTarget(stored: string): PaypalTarget {
  const value = normalizePaypalHandle(stored)

  return PAYPAL_CODE_ID.test(value)
    ? { kind: 'code', value }
    : { kind: 'handle', value }
}

/**
 * The link for whatever the payee stored, name or personal-code id.
 *
 * @param stored
 *   The stored value, as `parsePaypalQrPayload` or the connector normalized it.
 * @param amountCents
 *   The amount in cents, used only when the value is a name.
 * @throws
 *   When the stored value is neither a name nor a code id, so an arbitrary
 *   string can never end up in the link.
 */
export function paypalPaymentUrl(stored: string, amountCents: number): string {
  const target = parsePaypalTarget(stored)

  if (target.kind === 'code') {
    if (!PAYPAL_CODE_ID.test(target.value)) {
      throw new Error('The PayPal code id is invalid')
    }
    return `https://www.paypal.com/qrcodes/p2pqrc/${encodeURIComponent(target.value)}`
  }

  if (!PAYPAL_HANDLE.test(target.value)) {
    throw new Error('The PayPal name is invalid')
  }

  return `https://paypal.me/${encodeURIComponent(target.value)}/${amountText(amountCents)}EUR`
}

/**
 * The value out of a PayPal QR payload.
 *
 * Two shapes are recognized, because the app emits two:
 *
 * - the personal "your code" QR, which is a
 *   `paypal.com/qrcodes/p2pqrc/<id>` link. The id is an opaque account handle;
 *   it is a payment code another PayPal app scans, and it carries no
 *   `paypal.me` name, so the id itself is what is stored.
 * - a `paypal.me/<name>` or `paypal.com/paypalme/<name>` link, from the
 *   shareable codes, where the name is stored.
 *
 * Only `https` on the exact host is admitted, and only the id or name is kept,
 * so an arbitrary value cannot travel through. Returns the empty string for
 * anything else, which the field reports rather than guesses at.
 *
 * @param payload
 *   The decoded contents of the QR.
 */
export function parsePaypalQrPayload(payload: string): string {
  const url = parseHttpsUrl(payload)
  if (!url) {
    return ''
  }

  const host = url.hostname.toLowerCase()
  const segments = pathSegments(url)

  // `paypal.me/<name>`, with an optional amount and currency after it.
  if (host === 'paypal.me' || host === 'www.paypal.me') {
    const name = segments[0] ?? ''
    return PAYPAL_HANDLE.test(name) ? name : ''
  }

  if (host !== 'paypal.com' && host !== 'www.paypal.com') {
    return ''
  }

  const [first, second, third] = segments
  const shape = first?.toLowerCase()

  // `paypal.com/paypalme/<name>`
  if (shape === 'paypalme') {
    const name = second ?? ''
    return PAYPAL_HANDLE.test(name) ? name : ''
  }

  // `paypal.com/qrcodes/p2pqrc/<id>`
  if (shape === 'qrcodes' && second?.toLowerCase() === 'p2pqrc') {
    const id = third ?? ''
    return PAYPAL_CODE_ID.test(id) ? id : ''
  }

  return ''
}

/** Integer cents as a dot-decimal amount PayPal accepts, e.g. `17.99`. */
function amountText(amountCents: number): string {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('The amount must be a positive amount in cents')
  }

  return (amountCents / 100).toFixed(2)
}
