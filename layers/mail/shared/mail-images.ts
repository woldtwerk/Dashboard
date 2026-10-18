import { normalizeEmail } from '../../core/shared/entities'

/** An address, or a whole domain written as `@example.com` */
const DOMAIN_ENTRY = /^@[^\s@<>]+\.[^\s@<>]+$/

/**
 * Canonical form of a trusted-image entry: a lower-cased address (display name
 * and brackets stripped) or an `@domain` entry. Returns undefined when the
 * value is neither.
 */
export function normalizeTrustedImageSender(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const entry = value.trim().toLowerCase()
  if (entry.startsWith('@')) {
    return DOMAIN_ENTRY.test(entry) ? entry : undefined
  }

  return normalizeEmail(entry)
}

/**
 * The entry of `list` that trusts remote images from `from`, or undefined.
 * An address entry matches that address only; a domain entry (`@example.com`)
 * matches addresses at exactly that domain, not at its subdomains.
 */
export function trustedImageSender(from: string | null | undefined, list: readonly string[]): string | undefined {
  const address = normalizeEmail(from)
  if (!address) {
    return undefined
  }

  const domain = `@${address.slice(address.indexOf('@') + 1)}`

  for (const entry of list) {
    const normalized = normalizeTrustedImageSender(entry)
    if (normalized === address || normalized === domain) {
      return normalized
    }
  }

  return undefined
}

/** Whether remote images from `from` may load because its sender or domain is trusted */
export function isTrustedImageSender(from: string | null | undefined, list: readonly string[]): boolean {
  return !!trustedImageSender(from, list)
}

/** Remote content (images, tracking pixels, CSS backgrounds) the CSP otherwise blocks */
const REMOTE_IMAGE = /<img[^>]+src\s*=\s*["']?https?:|url\(\s*["']?https?:/i

export function hasRemoteImages(html?: string): boolean {
  return REMOTE_IMAGE.test(html ?? '')
}
