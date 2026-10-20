/**
 * Divides `totalCents` into `shares` equal parts with the largest-remainder
 * method, and returns what the first `payers` people owe. The owner keeps the
 * remaining shares, so a payer never pays more than `ceil(total / shares)` and
 * the odd cents land on the owner's share whenever the payer shares do not use
 * them all. All values are integer cents.
 */
export function splitAmount(totalCents: number, shares: number, payers: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error('The total must be a positive amount in cents')
  }
  if (!Number.isInteger(shares) || shares < 1) {
    throw new Error('There must be at least one share')
  }
  if (!Number.isInteger(payers) || payers < 1) {
    throw new Error('There must be at least one payer')
  }
  if (payers > shares) {
    throw new Error('There cannot be more payers than shares')
  }

  const base = Math.floor(totalCents / shares)
  const remainder = totalCents % shares

  return Array.from({ length: payers }, (_, index) => base + (index < remainder ? 1 : 0))
}
