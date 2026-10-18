import type { DashboardMetric, ServiceStatus } from '../../../core/shared/types/dashboard'
import type { ServiceInfo } from '../../../core/shared/types/setup'
import { weekRanges } from '../utils/documents-dashboard'

const SERIES_WEEKS = 12

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function status(service: ServiceInfo): Promise<Omit<ServiceStatus, 'id' | 'name' | 'domain' | 'icon'>> {
  try {
    await (await useDocumentsProvider(service.id)).ping()
    return { health: 'ok', syncedAt: null }
  } catch (error) {
    return { health: 'error', syncedAt: null, error: errorMessage(error) }
  }
}

async function inbox(): Promise<number | null> {
  const services = await listServices('documents')
  if (!services.length) {
    return null
  }

  const counts = await Promise.all(services.map(async service => (await useDocumentsProvider(service.id)).countInbox()))
  return counts.reduce((total, value) => total + value, 0)
}

async function added(): Promise<{ date: string, value: number }[]> {
  const services = await listServices('documents')
  if (!services.length) {
    return []
  }

  const ranges = weekRanges(new Date(), SERIES_WEEKS)
  const counts = await Promise.all(services.map(async (service) => {
    const provider = await useDocumentsProvider(service.id)
    return Promise.all(ranges.map(range => provider.countAdded(range.since, range.until)))
  }))

  return ranges.map((range, index) => ({
    date: range.since,
    value: counts.reduce((total, serviceCounts) => total + (serviceCounts[index] ?? 0), 0)
  }))
}

export default defineNitroPlugin(() => {
  registerDashboardSource('documents', {
    status,
    async metrics(): Promise<DashboardMetric[]> {
      return [{
        id: 'documents-inbox',
        domain: 'documents',
        label: 'Inbox documents',
        value: await inbox(),
        unit: 'count',
        icon: 'i-lucide-inbox',
        to: '/documents?inbox=1'
      }]
    },
    series: {
      'documents-added': {
        info: { label: 'Documents added', bucket: 'week' },
        points: added
      }
    }
  })
})
