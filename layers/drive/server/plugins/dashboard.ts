import type { DashboardMetric, ServiceStatus } from '../../../core/shared/types/dashboard'
import type { ServiceInfo } from '../../../core/shared/types/setup'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function status(service: ServiceInfo): Promise<Omit<ServiceStatus, 'id' | 'name' | 'domain' | 'icon'>> {
  try {
    const provider = await useDriveProvider(service.id)
    if (!provider.status) {
      return { health: 'unknown', syncedAt: null }
    }
    return { ...(await provider.status()), syncedAt: null }
  } catch (error) {
    return { health: 'error', syncedAt: null, error: errorMessage(error) }
  }
}

async function usedBytes(): Promise<number | null> {
  const services = await listServices('drive')
  if (!services.length) {
    return null
  }

  const sizes = await Promise.all(services.map(async service => (await useDriveProvider(service.id)).usedBytes()))
  return sizes.reduce((total, size) => total + size, 0)
}

export default defineNitroPlugin(() => {
  registerDashboardSource('drive', {
    status,
    async metrics(): Promise<DashboardMetric[]> {
      return [{
        id: 'drive-used',
        domain: 'drive',
        label: 'Drive used',
        value: await usedBytes(),
        unit: 'bytes',
        icon: 'i-lucide-hard-drive',
        to: '/drive'
      }]
    }
  })
})
