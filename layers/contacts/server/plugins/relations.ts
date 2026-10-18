import { entityLink, normalizeEmail } from '../../../core/shared/entities'
import type { EntityRef, Relation } from '../../../core/shared/types/entities'
import { registerRelationProvider } from '../../../core/server/utils/relations'
import type { Contact } from '../../shared/types/contacts'

interface ServiceContact {
  service: string
  contact: Contact
}

function contactRef(service: string, contact: Contact): EntityRef {
  return { type: 'contact', service, id: contact.uid }
}

function personRef(email: string): EntityRef {
  return { type: 'person', id: email }
}

/** The normalized addresses of a card, deduplicated */
function contactEmails(contact: Contact): string[] {
  const emails = new Set<string>()

  for (const { value } of contact.emails) {
    const email = normalizeEmail(value)
    if (email) emails.add(email)
  }

  return [...emails]
}

/** Every card of every contacts service; a broken service contributes none */
async function listAllContacts(): Promise<ServiceContact[]> {
  const services = await listServices('contacts')

  const results = await Promise.all(services.map(async ({ id }): Promise<ServiceContact[]> => {
    try {
      const provider = await useContactsProvider(id)
      const addressBooks = await provider.listAddressBooks()
      const lists = await Promise.all(addressBooks.map(addressBook => provider.listContacts(addressBook.url)))

      return lists.flat().map(contact => ({ service: id, contact }))
    } catch (error) {
      useServiceLogger('contacts', id).warn('Could not read contacts', { error: String(error) })
      return []
    }
  }))

  return results.flat()
}

function toRelation(service: string, contact: Contact): Relation {
  const ref = contactRef(service, contact)

  return {
    kind: 'contact',
    weight: 1,
    item: {
      ref,
      title: contact.name || contactEmails(contact)[0] || 'Unnamed contact',
      subtitle: contact.organization,
      to: entityLink(ref),
      icon: 'i-lucide-contact'
    }
  }
}

async function relatedToPerson(email: string, limit: number): Promise<Relation[]> {
  const cards = (await listAllContacts())
    .filter(({ contact }) => contactEmails(contact).includes(email))
    .slice(0, Math.max(0, limit) + 1)

  return cards.map(({ service, contact }) => toRelation(service, contact))
}

async function relatedToContact(ref: EntityRef, limit: number): Promise<Relation[]> {
  const found = (await listAllContacts())
    .find(({ service, contact }) => contact.uid === ref.id && (!ref.service || ref.service === service))
  if (!found) {
    return []
  }

  const { contact } = found
  const name = contact.name || contact.organization

  return contactEmails(contact).slice(0, Math.max(0, limit) + 1).map((email) => {
    const person = personRef(email)

    return {
      kind: 'contact',
      weight: 1,
      item: {
        ref: person,
        title: name || email,
        subtitle: name ? email : undefined,
        to: entityLink(person),
        icon: 'i-lucide-user'
      }
    }
  })
}

/** The first card holding the address; its name and every address on it */
async function knownPerson(email: string): Promise<{ name?: string, emails: string[], contacts: EntityRef[] } | undefined> {
  const found = (await listAllContacts())
    .find(({ contact }) => contactEmails(contact).includes(email))
  if (!found) {
    return undefined
  }

  const emails = contactEmails(found.contact)

  return {
    name: found.contact.name || found.contact.organization || undefined,
    emails: emails.length ? emails : [email],
    contacts: [contactRef(found.service, found.contact)]
  }
}

export default defineNitroPlugin(() => {
  registerRelationProvider('contacts', {
    label: 'Contacts',
    related(ref, { limit }) {
      if (ref.type === 'person') {
        return relatedToPerson(normalizeEmail(ref.id) ?? ref.id, limit)
      }
      return ref.type === 'contact' ? relatedToContact(ref, limit) : Promise.resolve([])
    },
    person: knownPerson
  })
})

export { contactEmails }
