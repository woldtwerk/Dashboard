import type { DashboardMetric } from '../../../core/shared/types/dashboard'

async function total(): Promise<number | null> {
  const services = await listServices('contacts')
  if (!services.length) {
    return null
  }

  const counts = await Promise.all(services.map(async (service) => {
    await ensureContactsSynced(service.id)

    return (await cachedContacts(service.id)).length
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
