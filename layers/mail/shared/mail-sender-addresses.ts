import { normalizeEmail } from '../../core/shared/entities'

/** At most this many extra From addresses may be added per account */
export const SENDER_ADDRESSES_MAX = 50

/** Canonical form of a manual From address, or undefined when it is not one */
export function normalizeSenderAddress(value: string | null | undefined): string | undefined {
  return normalizeEmail(value)
}

/**
 * Every address the account may send from, in display order: the setup login,
 * then the addresses added by hand, then the From addresses of recent Sent mail.
 * Repeats are dropped, so a manual alias the sent mail also reveals shows once.
 */
export function mergeSenderAddresses(setup: string | undefined, manual: readonly string[], sent: readonly string[]): string[] {
  const addresses = new Set<string>()

  for (const value of [setup, ...manual, ...sent]) {
    const normalized = normalizeSenderAddress(value)
    if (normalized) {
      addresses.add(normalized)
    }
  }

  return [...addresses]
}

/** The outcome of adding one manual From address */
export type AddSenderAddressResult
  = | { ok: true, addresses: string[] }
    | { ok: false, error: string }

/**
 * Adds one address to a manual list: normalized, not a repeat and within the
 * limit. An invalid or duplicate entry changes nothing and says why.
 */
export function addSenderAddress(addresses: readonly string[], entry: string | null | undefined): AddSenderAddressResult {
  const normalized = normalizeSenderAddress(entry)
  if (!normalized) {
    return { ok: false, error: 'Enter an email address such as alias@example.com.' }
  }
  if (addresses.some(address => normalizeSenderAddress(address) === normalized)) {
    return { ok: false, error: 'This address is already in the list.' }
  }
  if (addresses.length >= SENDER_ADDRESSES_MAX) {
    return { ok: false, error: `At most ${SENDER_ADDRESSES_MAX} addresses per account are allowed.` }
  }

  return { ok: true, addresses: [...addresses, normalized] }
}

/** The manual list without one address; an unknown address leaves it unchanged */
export function removeSenderAddress(addresses: readonly string[], entry: string | null | undefined): string[] {
  const normalized = normalizeSenderAddress(entry)
  return addresses.filter(address => normalizeSenderAddress(address) !== normalized)
}
