import type { Contact } from '../../shared/types/contacts'
import { matchContact } from '../../app/utils/contacts'

/** Contacts of one service (or one address book) that match the free-text query */
export async function listServiceContacts(service: string, addressBook: string | undefined, q: string | undefined): Promise<Contact[]> {
  const provider = await useContactsProvider(service)
  const books = addressBook ? [addressBook] : (await provider.listAddressBooks()).map(item => item.url)
  const lists = await Promise.all(books.map(url => provider.listContacts(url)))

  return lists.flat()
    .filter(contact => matchContact(contact, q ?? ''))
    .map(item => ({ ...item, service }))
}

/** Matching contacts across every contacts service, capped for the global search */
export async function searchContacts(q: string, limit: number): Promise<Contact[]> {
  const services = await listServices('contacts')
  const found: Contact[] = []

  for (const { id } of services) {
    try {
      found.push(...await listServiceContacts(id, undefined, q))
    } catch {
      // One unreachable address book must not hide the others
    }
  }

  return found.slice(0, Math.max(0, limit))
}
