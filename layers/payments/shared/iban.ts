/** Upper-case, without spaces; anything else in the value is left alone. */
export function normalizeIban(value: string): string {
  return value.replace(/[\s\u00a0\u202f]/g, '').toUpperCase()
}

/**
 * Checks shape and mod-97, the check every IBAN carries. The country length
 * table is not needed: mod-97 plus the 15–34 character range already rejects a
 * mistyped or truncated account.
 */
export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return false
  }

  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const digits = char >= 'A' ? String(char.charCodeAt(0) - 55) : char
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97
    }
  }

  return remainder === 1
}

/** Groups of four, e.g. `DE89 3704 0044 0532 0130 00`. */
export function formatIban(value: string): string {
  return normalizeIban(value).match(/.{1,4}/g)?.join(' ') ?? ''
}
