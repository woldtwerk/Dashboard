const PAYPAL_USERNAME = /^[A-Za-z0-9]{1,20}$/

/** Whether a PayPal.me username is one the link can carry. */
export function isValidPaypalUsername(username: string): boolean {
  return PAYPAL_USERNAME.test(username)
}

/**
 * A PayPal.me link for the exact amount, e.g.
 * `https://paypal.me/maxmustermann/17.99EUR`. The amount uses a dot and two
 * decimals because PayPal rejects the German comma.
 */
export function paypalMeLink(username: string, amountCents: number): string {
  if (!isValidPaypalUsername(username)) {
    throw new Error('The PayPal.me username is invalid')
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('The amount must be a positive amount in cents')
  }

  return `https://paypal.me/${encodeURIComponent(username)}/${(amountCents / 100).toFixed(2)}EUR`
}
