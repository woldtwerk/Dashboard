import type { Contact } from '#layers/contacts/shared/types/contacts'

/** The name contacts are sorted and grouped by; the organization when there is no person. */
export function sortName(contact: Contact): string {
  if (contact.lastName || contact.firstName) {
    return [contact.lastName, contact.firstName].filter(Boolean).join(' ').trim()
  }
  return contact.organization || contact.name || ''
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/** The A–Z bucket of a contact; anything not a Latin letter goes under `#`. */
export function contactInitial(contact: Contact): string {
  const first = sortName(contact).trim().charAt(0).toUpperCase()
  return LETTERS.includes(first) ? first : '#'
}

export interface ContactGroup {
  letter: string
  contacts: Contact[]
}

/** Contacts grouped under A–Z headers, each group sorted by name. */
export function groupContacts(contacts: Contact[]): ContactGroup[] {
  const groups = new Map<string, Contact[]>()

  for (const contact of [...contacts].sort((a, b) => sortName(a).localeCompare(sortName(b), undefined, { sensitivity: 'base' }))) {
    const letter = contactInitial(contact)
    groups.set(letter, [...groups.get(letter) ?? [], contact])
  }

  // Letters first, `#` last
  return [...groups.entries()]
    .map(([letter, grouped]) => ({ letter, contacts: grouped }))
    .sort((a, b) => (a.letter === '#' ? 1 : b.letter === '#' ? -1 : a.letter.localeCompare(b.letter)))
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

/** Whether a contact matches a free-text search, across names, org, mail, phone and notes. */
export function matchContact(contact: Contact, query: string): boolean {
  const needle = normalize(query)
  if (!needle) {
    return true
  }

  const haystack = [
    contact.name,
    contact.firstName,
    contact.lastName,
    contact.organization,
    contact.jobTitle,
    contact.notes,
    ...contact.emails.map(email => email.value),
    ...contact.phones.map(phone => phone.value),
    ...contact.addresses.map(address => [address.street, address.city, address.country].filter(Boolean).join(' '))
  ]

  return haystack.some(value => !!value && normalize(value).includes(needle))
}

/** The one-line description under a contact's name. */
export function contactSubtitle(contact: Contact): string {
  return [contact.organization, contact.jobTitle].filter(Boolean).join(' · ')
    || contact.emails[0]?.value
    || contact.phones[0]?.value
    || ''
}
