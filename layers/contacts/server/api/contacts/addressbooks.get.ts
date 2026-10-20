import { defineEventHandler, isNuxtError } from 'nuxt/server'
import type { ContactList } from '../../../shared/types/contacts'

// Address books of all contacts services, served from the local cache; one
// unreachable service doesn't break the others
export default defineEventHandler(async () => {
  const services = await listServices('contacts')

  return Promise.all(services.map(async ({ id, name, icon }): Promise<ContactList> => {
    try {
      await ensureContactsSynced(id)
      const addressBooks = (await cachedAddressBooks(id)).map(book => ({ ...book, service: id, serviceName: name, icon }))

      return { service: { id, name, icon }, addressBooks }
    } catch (error) {
      return { service: { id, name, icon }, addressBooks: [], error: (isNuxtError(error) && error.statusText) || 'Unavailable' }
    }
  }))
})
