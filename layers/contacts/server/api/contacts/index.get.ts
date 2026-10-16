import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import type { Contact } from '../../../shared/types/contacts'
import { matchContact } from '../../../app/utils/contacts'
import { contactsQuerySchema } from '../../utils/contacts-schema'

export default defineEventHandler(async (event) => {
  const { service, addressBook, q } = await getValidatedQuery(event, contactsQuerySchema)
  const services = service ? [service] : (await listServices('contacts')).map(item => item.id)

  const results = await Promise.all(services.map(async (id) => {
    try {
      return await listServiceContacts(id, addressBook, q)
    } catch (error) {
      // A single requested service reports its own error; across services, one
      // failing must not hide the others.
      if (service) {
        throw error
      }
      return []
    }
  }))

  return results.flat()
})

async function listServiceContacts(id: string, addressBook: string | undefined, q: string | undefined): Promise<Contact[]> {
  const provider = await useContactsProvider(id)
  const books = addressBook ? [addressBook] : (await provider.listAddressBooks()).map(item => item.url)
  const lists = await Promise.all(books.map(url => provider.listContacts(url)))

  return lists.flat()
    .filter(contact => matchContact(contact, q ?? ''))
    .map(item => ({ ...item, service: id }))
}
