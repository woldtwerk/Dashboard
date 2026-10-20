import { findReference, normalizeReference } from './reference'

/** An open payment request as the matcher sees it. */
export interface OpenRequest {
  id: string
  reference: string
  amountCents: number
  payerName: string
}

export interface IncomingPayment {
  amountCents: number
  payerName?: string
  /** Free text of the transfer or mail, searched for a reference */
  text?: string
}

export type PaymentMatch
  = | { kind: 'reference', request: OpenRequest }
    | { kind: 'amount-name', request: OpenRequest }
    | { kind: 'ambiguous', candidates: OpenRequest[] }
    | { kind: 'none' }

/**
 * NFKD, diacritics stripped, lower case, split into words. So `Müller` and
 * `MÜLLER` compare equal, and punctuation does not stand in the way.
 */
export function nameTokens(name: string | undefined): string[] {
  if (!name) {
    return []
  }

  return name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** Every word of the shorter name appears in the longer one. */
function namesMatch(left: string, right: string): boolean {
  const leftTokens = new Set(nameTokens(left))
  const rightTokens = new Set(nameTokens(right))
  if (!leftTokens.size || !rightTokens.size) {
    return false
  }

  const [shorter, longer] = leftTokens.size <= rightTokens.size
    ? [leftTokens, rightTokens]
    : [rightTokens, leftTokens]

  return [...shorter].every(token => longer.has(token))
}

/**
 * Finds the open request an incoming payment belongs to. A reference in the
 * text wins over the amount and the payer name — and still wins when only part
 * of the amount arrived, because the caller records that as a partial payment.
 * Without a reference, exactly one request of that amount and a matching payer
 * name is a match; several are ambiguous and left for a human.
 */
export function matchPayment(open: OpenRequest[], incoming: IncomingPayment): PaymentMatch {
  const reference = incoming.text ? findReference(incoming.text) : undefined
  if (reference) {
    const request = open.find(candidate => normalizeReference(candidate.reference) === reference)
    if (request) {
      return { kind: 'reference', request }
    }
  }

  const payerName = incoming.payerName
  if (!payerName) {
    return { kind: 'none' }
  }

  const candidates = open.filter(candidate =>
    candidate.amountCents === incoming.amountCents && namesMatch(candidate.payerName, payerName)
  )

  if (candidates.length === 1) {
    return { kind: 'amount-name', request: candidates[0]! }
  }
  if (candidates.length > 1) {
    return { kind: 'ambiguous', candidates }
  }

  return { kind: 'none' }
}
