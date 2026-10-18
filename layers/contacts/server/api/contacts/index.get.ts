import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
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
