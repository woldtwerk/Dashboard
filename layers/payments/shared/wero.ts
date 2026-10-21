/**
 * The Wero side of a payment request.
 *
 * The payee stores the share token out of the QR the Wero app shows, never the
 * link itself. The payment URL is built here, in one place, so a stored value
 * cannot smuggle an arbitrary URL into a QR or a mail.
 */

import { parseHttpsUrl } from './payment-url'

/** A Wero share token, as the app puts it in the link. */
const WERO_TOKEN = /^[A-Za-z0-9_-]{6,128}$/

/**
 * Whether a stored value is a Wero share token.
 *
 * @param value
 *   The stored value.
 */
export function isValidWeroToken(value: string): boolean {
  return WERO_TOKEN.test(value.trim())
}

/**
 * The share token out of a Wero payment QR payload.
 *
 * The payload the Wero app encodes is a `share.weropay.eu/p/1/c/<token>` link
 * — the `c` is what the app itself emits, an amount in the query string is
 * optional and does not change the path. Only `https` on the exact host is
 * admitted. The older `s` segment is still accepted, so a code from a build of
 * the app that used it keeps working. Only the token is kept, so what is stored
 * is an identifier rather than a URL. Returns the empty string for anything
 * that is not such a link.
 *
 * @param payload
 *   The decoded contents of the QR.
 */
export function parseWeroQrPayload(payload: string): string {
  const url = parseHttpsUrl(payload)
  if (!url || url.hostname.toLowerCase() !== 'share.weropay.eu') {
    return ''
  }

  const [first, version, kind, token] = url.pathname.split('/').filter(Boolean)

  if (first !== 'p' || !/^\d+$/.test(version ?? '') || (kind !== 'c' && kind !== 's')) {
    return ''
  }

  return token && WERO_TOKEN.test(token) ? token : ''
}

/**
 * The `https://share.weropay.eu/...` link for the payee's share token.
 *
 * The format comes from the Wero app: the token sits at `/p/1/c/<token>`, and
 * the amount travels as whole cents in `a` with the currency in `c`. Both
 * parameters are optional in the app, so a caller without an amount gets a
 * bare request.
 *
 * @param token
 *   The stored share token, e.g. `d6xY21Hybs`.
 * @param amountCents
 *   The amount in cents. Omitted from the link when not given.
 * @throws
 *   When the token is not one a Wero link can carry, so an arbitrary string
 *   can never end up in the link.
 */
export function weroPaymentUrl(token: string, amountCents?: number): string {
  const id = token.trim()
  if (!WERO_TOKEN.test(id)) {
    throw new Error('The Wero share token is invalid')
  }

  const url = `https://share.weropay.eu/p/1/c/${encodeURIComponent(id)}`

  if (amountCents === undefined) {
    return url
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('The amount must be a positive amount in cents')
  }

  return `${url}?a=${amountCents}&c=EUR`
}
