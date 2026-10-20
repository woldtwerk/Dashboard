/**
 * Payment references: `AM-` plus six Crockford base32 characters. The alphabet
 * leaves out I, L, O and U, so a reference survives being read aloud or typed
 * from a screenshot. `findReference` reads them back from free text, mapping the
 * look-alikes O→0 and I/L→1.
 */

export const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const REFERENCE_LENGTH = 6
const LOOKALIKES: Record<string, string> = { O: '0', I: '1', L: '1' }

/** A byte source, e.g. `crypto.getRandomValues`; injectable for tests. */
export type RandomSource = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>

const randomBytes: RandomSource = bytes => crypto.getRandomValues(bytes)

/** A new reference with six uniformly random Crockford characters. */
export function createReference(random: RandomSource = randomBytes): string {
  const bytes = new Uint8Array(REFERENCE_LENGTH)
  random(bytes)

  return `AM-${Array.from(bytes, byte => REFERENCE_ALPHABET[byte & 31]).join('')}`
}

/**
 * The canonical form of a reference, or undefined when the value is not one.
 * Tolerates lower case, a missing dash, spaces and the Crockford look-alikes.
 */
export function normalizeReference(value: string): string | undefined {
  const compact = value.trim().toUpperCase().replace(/[\s-]+/g, '')
  if (!new RegExp(`^AM[0-9A-Z]{${REFERENCE_LENGTH}}$`).test(compact)) {
    return undefined
  }

  const body = Array.from(compact.slice(2), char => LOOKALIKES[char] ?? char)
  if (!body.every(char => REFERENCE_ALPHABET.includes(char))) {
    return undefined
  }

  return `AM-${body.join('')}`
}

/**
 * Finds the first reference in free text, e.g. a bank transfer's purpose or a
 * PayPal note, and returns it in canonical form. A word that merely starts with
 * AM is not one: the six characters must stand on their own.
 */
export function findReference(text: string): string | undefined {
  for (const match of text.matchAll(/\bAM[-\s]*([0-9A-Z]{6})\b/gi)) {
    const reference = normalizeReference(`AM-${match[1]}`)
    if (reference) {
      return reference
    }
  }

  return undefined
}
