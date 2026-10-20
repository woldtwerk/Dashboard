/**
 * Whether a mail really came from the domain it claims to come from, read from
 * its `Authentication-Results` headers.
 *
 * Only the topmost header counts: the receiving server writes it, while a sender
 * can add headers of its own. If the topmost one was not written by a server we
 * trust, or it does not carry a DKIM pass for the expected domain, the mail is
 * treated as unauthenticated.
 */

/** A raw header block split into the values of one header, in header order */
export function authenticationResultsFromRaw(raw: string): string[] {
  const values: string[] = []
  let currentIndex = -1

  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^[ \t]/.test(line) && currentIndex >= 0) {
      values[currentIndex] = `${values[currentIndex]} ${line.trim()}`
      continue
    }

    const match = /^([^:\s]+):[ \t]?(.*)$/.exec(line)
    if (!match) {
      currentIndex = -1
      continue
    }

    currentIndex = -1
    if (match[1]!.toLowerCase() !== 'authentication-results') {
      continue
    }
    values.push(match[2] ?? '')
    currentIndex = values.length - 1
  }

  return values
}

/** The domain part of a DKIM `header.i` identifier, e.g. `paypal.de` from `@paypal.de` */
function identifierDomain(identifier: string | undefined): string | undefined {
  if (!identifier) {
    return undefined
  }
  const at = identifier.lastIndexOf('@')
  return (at >= 0 ? identifier.slice(at + 1) : identifier).trim().toLowerCase().replace(/\.$/, '') || undefined
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '')
}

/** Whether `domain` is one of `allowed` or a subdomain of one */
export function isDomainWithin(domain: string, allowed: readonly string[]): boolean {
  const normalized = normalizeDomain(domain)
  if (!normalized) {
    return false
  }

  return allowed.some((entry) => {
    const root = normalizeDomain(entry)
    return !!root && (normalized === root || normalized.endsWith(`.${root}`))
  })
}

/**
 * Whether the topmost `Authentication-Results` header was written by a trusted
 * authserv-id and holds a `dkim=pass` whose signing domain is (a subdomain of)
 * one of `domains`. A missing header, a topmost header from an untrusted server,
 * a failed signature or a pass for another domain all answer `false`.
 */
export function isDkimAligned(
  headers: readonly string[],
  options: { trustedAuthservIds: readonly string[], domains: readonly string[] }
): boolean {
  const topmost = headers[0]
  if (!topmost) {
    return false
  }

  const separator = topmost.indexOf(';')
  if (separator < 0) {
    return false
  }

  const authservId = topmost.slice(0, separator).trim().toLowerCase()
  if (!options.trustedAuthservIds.some(trusted => trusted.trim().toLowerCase() === authservId)) {
    return false
  }

  // Results are `;`-separated methods after the authserv-id, e.g.
  // `dkim=pass (2048-bit key) header.d=paypal.de header.s=...`
  for (const method of topmost.slice(separator + 1).split(';')) {
    const match = /^\s*dkim\s*=\s*pass\b(.*)$/i.exec(method)
    if (!match) {
      continue
    }

    const rest = match[1] ?? ''
    const signingDomain = /header\.d\s*=\s*"?([^"\s;]+)"?/i.exec(rest)?.[1]
      ?? identifierDomain(/header\.i\s*=\s*"?([^"\s;]+)"?/i.exec(rest)?.[1])
    if (signingDomain && isDomainWithin(signingDomain, options.domains)) {
      return true
    }
  }

  return false
}
