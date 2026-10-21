import { dkimVerify } from 'mailauth'
import type { DNSResolver } from 'mailauth'
import { simpleParser } from 'mailparser'

/** What a sender check answers; `reason` says why a mail was not accepted */
export interface SenderVerdict {
  ok: boolean
  reason?: string
  /**
   * The Subject of a verified mail. It is read from the source the signature
   * was checked against, so a caller parses the subject the signature covers.
   */
  subject?: string
}

export interface SenderVerificationOptions {
  /** The domains a signature may be for; a subdomain of one counts */
  domains: readonly string[]
  /**
   * The addresses the mail must be addressed to; an empty list counts as none.
   * A signature stays valid when a genuine mail is forwarded or bounced, so
   * without this check a mail PayPal sent to someone else's account would count
   * for this one. Given, the mail must be addressed to one of them and the
   * signature must cover `To`.
   */
  recipients?: readonly string[]
  /** DNS resolver; without one mailauth asks the system resolver. Injectable for tests */
  resolver?: DNSResolver
}

/**
 * The headers a signature must cover: without `From` it signs nothing that names
 * the sender, and without `Subject` the mail a reader sees could be another one.
 */
const REQUIRED_SIGNED_HEADERS = ['from', 'subject'] as const

function normalizeDomain(value: string | undefined): string | undefined {
  const domain = value?.trim().toLowerCase().replace(/\.$/, '')
  return domain || undefined
}

/** Whether `domain` is `root` or a subdomain of it */
function withinDomain(domain: string, root: string): boolean {
  return domain === root || domain.endsWith(`.${root}`)
}

/** The domain of an addr-spec, e.g. `paypal.de` from `service@paypal.de` */
function addressDomain(address: string | undefined): string | undefined {
  const value = address ?? ''
  const at = value.lastIndexOf('@')
  return at < 0 ? undefined : normalizeDomain(value.slice(at + 1))
}

/** The header names a signature covers, from the `h=` tag, lower-cased */
function signedHeaders(keys: string | undefined): string[] {
  return (keys ?? '')
    .split(':')
    .map(name => name.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * How often each header name occurs in the raw header block. Folded lines are
 * skipped, names compare case-insensitively, and the first empty line ends the
 * headers. A signature covers one instance of each name in `h=`, so a second
 * one is unsigned and a reader may show it instead.
 */
function headerCounts(raw: Buffer | string): Map<string, number> {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8')
  const counts = new Map<string, number>()

  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      break
    }
    if (/^[ \t]/.test(line)) {
      continue
    }
    const name = /^([^:\s]+)[ \t]*:/.exec(line)?.[1]?.toLowerCase()
    if (name) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }

  return counts
}

/**
 * The addr-specs the mail is addressed to, lower-cased and without display
 * names, and its Subject. mailparser's address parser reads groups, folding and
 * quoting, so a name that happens to hold an `@` cannot stand in for an address.
 * Called only once the header counts proved there is a single To and Subject.
 */
async function headerFields(
  headerBlock: Buffer | string | undefined,
  raw: Buffer | string
): Promise<{ to: string[], subject?: string }> {
  const parsed = await simpleParser(headerBlock ?? raw)
  const fields = !parsed.to ? [] : Array.isArray(parsed.to) ? parsed.to : [parsed.to]
  const to: string[] = []

  for (const field of fields) {
    for (const entry of field.value) {
      const address = entry.address?.trim().toLowerCase()
      if (address) {
        to.push(address)
      }
    }
  }

  return { to, subject: parsed.subject }
}

/**
 * Whether a mail really was signed by one of `domains`, read from its raw
 * source rather than from an `Authentication-Results` header, which any relay
 * (or the sender) can write. Accepted only when a signature passes and
 *
 * - its signing domain is (a subdomain of) one of `domains`,
 * - it is aligned with the RFC5322.From domain (relaxed alignment: the same
 *   organizational domain, which for PayPal's domains is an exact or subdomain
 *   match),
 * - it covers `From` and `Subject`, plus `To` when `recipients` names at least
 *   one address, and the mail is addressed to one of those recipients — a
 *   forwarded genuine mail keeps its signature but names the account it was
 *   sent to,
 * - it carries no `l=` body length tag, which would leave the rest of the body
 *   unsigned,
 * - the message carries exactly one `From`, one `To` and one `Subject` header,
 *   so no client can be shown a header the signature never covered — and the
 *   verdict's `subject` is the one the signature covers.
 *
 * Everything else answers `ok: false` with a reason. Callers fail closed.
 */
export async function verifySenderDkim(
  raw: Buffer | string,
  options: SenderVerificationOptions
): Promise<SenderVerdict> {
  let verified: Awaited<ReturnType<typeof dkimVerify>>
  try {
    verified = await dkimVerify(raw, options.resolver ? { resolver: options.resolver } : {})
  } catch {
    return { ok: false, reason: 'The message could not be read' }
  }

  // A second From header is unsigned whenever the signature covers one, so a
  // viewer could be shown a different sender than the one that was signed
  if (verified.fromFields !== 1) {
    return { ok: false, reason: `The message has ${verified.fromFields} From headers` }
  }
  if (verified.headerFrom.length !== 1) {
    return { ok: false, reason: 'The From header names no single address' }
  }
  const fromDomain = addressDomain(verified.headerFrom[0])
  if (!fromDomain) {
    return { ok: false, reason: 'The From header names no domain' }
  }

  // A signature covers one instance of each name in `h=`. A second To or
  // Subject is unsigned, and a mail reader may show that one instead — so a
  // forwarded genuine mail with `To: <owner>` stacked above it would pass.
  const counts = headerCounts(raw)
  const toFields = counts.get('to') ?? 0
  if (toFields !== 1) {
    return { ok: false, reason: `The message has ${toFields} To headers` }
  }
  const subjectFields = counts.get('subject') ?? 0
  if (subjectFields !== 1) {
    return { ok: false, reason: `The message has ${subjectFields} Subject headers` }
  }

  const { to, subject } = await headerFields(verified.headers?.original, raw)
  const domains = options.domains.map(normalizeDomain).filter(Boolean) as string[]
  // An empty list names no recipient, so it counts as no list at all: requiring
  // a To match against nothing would reject every mail
  const wanted = (options.recipients ?? []).map(recipient => recipient.trim().toLowerCase())
  let reason = 'The message carries no passing DKIM signature'

  for (const signature of verified.results) {
    if (signature.status.result !== 'pass') {
      continue
    }

    const signingDomain = normalizeDomain(signature.signingDomain)
    if (!signingDomain || !domains.some(root => withinDomain(signingDomain, root))) {
      reason = `The signature is for ${signingDomain ?? 'an unknown domain'}`
      continue
    }

    // Relaxed alignment compares organizational domains; for PayPal that is an
    // exact or subdomain match in either direction
    if (!withinDomain(signingDomain, fromDomain) && !withinDomain(fromDomain, signingDomain)) {
      reason = 'The signature is not aligned with the From domain'
      continue
    }

    // A signed body length leaves every byte after it unsigned, so anything
    // could follow the signed text
    if (signature.canonBodyLengthLimited) {
      reason = 'The signature leaves part of the body unsigned'
      continue
    }

    const signed = signedHeaders(signature.signingHeaders?.keys)
    if (!REQUIRED_SIGNED_HEADERS.every(name => signed.includes(name))) {
      reason = 'The signature does not cover the From and Subject headers'
      continue
    }

    // The recipient cannot be taken from an unsigned To header: a mail to
    // another account could be sent on with the To line rewritten
    if (wanted.length) {
      if (!signed.includes('to')) {
        reason = 'The signature does not cover the To header'
        continue
      }
      if (!wanted.some(recipient => to.includes(recipient))) {
        reason = 'The mail is addressed to another PayPal account'
        continue
      }
    }

    return { ok: true, subject }
  }

  return { ok: false, reason }
}
