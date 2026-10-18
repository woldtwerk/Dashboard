import type { DashboardMetric } from '../../../core/shared/types/dashboard'

async function total(): Promise<number | null> {
  const services = await listServices('contacts')
  if (!services.length) {
    return null
  }

  const counts = await Promise.all(services.map(async (service) => {
    const provider = await useContactsProvider(service.id)
    const addressBooks = await provider.listAddressBooks()
    const contacts = await Promise.all(addressBooks.map(addressBook => provider.listContacts(addressBook.url)))

    return contacts.reduce((sum, entries) => sum + entries.length, 0)
  }))

  return counts.reduce((sum, value) => sum + value, 0)
}

export default defineNitroPlugin(() => {
  registerDashboardSource('contacts', {
    async metrics(): Promise<DashboardMetric[]> {
      return [{
        id: 'contacts-total',
        domain: 'contacts',
        label: 'Contacts',
        value: await total(),
        unit: 'count',
        icon: 'i-lucide-users',
        to: '/contacts'
      }]
    }
  })
})
