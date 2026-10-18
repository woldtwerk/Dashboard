import { entityKey, normalizeEmail } from '../../../core/shared/entities'
import type { Relation } from '../../../core/shared/types/entities'
import type { DocumentsCorrespondent } from '../../shared/types/documents'

/** Addresses in running text; the look-alike domain part keeps `foo@bar.baz` whole */
const EMAIL_PATTERN = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g

/** At most this many addresses are taken from one document's text */
export const MAX_DOCUMENT_EMAILS = 10

/** Normalized addresses found in a text, deduplicated and capped */
export function extractEmails(text: string | undefined, max = MAX_DOCUMENT_EMAILS): string[] {
  if (!text) {
    return []
  }

  const emails = new Set<string>()
  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const email = normalizeEmail(match[0])
    if (email) {
      emails.add(email)
    }
    if (emails.size >= max) {
      break
    }
  }

  return [...emails]
}

/** The first address in a value, ignoring wildcard match patterns like `*@example.com` */
function deriveEmail(value: string | undefined): string | undefined {
  return extractEmails(value, 5).find(email => !email.includes('*') && !email.includes('?'))
}

/** The address a correspondent can be reached at, from its match rule or its name */
export function correspondentEmail(correspondent: Pick<DocumentsCorrespondent, 'name' | 'match'>): string | undefined {
  return deriveEmail(correspondent.match) ?? deriveEmail(correspondent.name)
}

/**
 * Whether a correspondent belongs to a person: its name is the person's name, or
 * its match rule contains the normalized address.
 */
export function correspondentMatches(
  correspondent: Pick<DocumentsCorrespondent, 'name' | 'match'>,
  email: string,
  personName?: string
): boolean {
  const normalized = normalizeEmail(email) ?? email.trim().toLowerCase()

  if (personName && correspondent.name.trim().toLowerCase() === personName.trim().toLowerCase()) {
    return true
  }

  return !!correspondent.match && correspondent.match.toLowerCase().includes(normalized)
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
}

/**
 * The full-text terms worth trying for a person: the quoted address always, and
 * the quoted full name when it has at least two words.
 */
export function quotedSearchTerms(email: string, name?: string): string[] {
  const terms = [quote(email)]
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? []

  if (words.length >= 2) {
    terms.push(quote(words.join(' ')))
  }

  return terms
}

/** One relation per item, keeping the stronger kind when two searches found it */
export function dedupeRelations(relations: Relation[]): Relation[] {
  const byItem = new Map<string, Relation>()

  for (const relation of relations) {
    const key = entityKey(relation.item.ref)
    const known = byItem.get(key)
    if (!known || relation.weight > known.weight) {
      byItem.set(key, relation)
    }
  }

  return [...byItem.values()]
}
