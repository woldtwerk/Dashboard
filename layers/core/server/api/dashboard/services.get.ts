import { defineEventHandler } from 'nuxt/server'
import type { ServiceStatus } from '../../../shared/types/dashboard'
import { dashboardStatusKey } from '../../utils/dashboard'

// Every configured service, with identity read live and health from the shared SWR cache
export default defineEventHandler(async (): Promise<ServiceStatus[]> => {
  const services = await listServices()
  return Promise.all(services.map(async (service) => {
    const health = await cachedSwr(
      dashboardStatusKey(service.id),
      () => dashboardServiceHealth(service),
      SERVICE_STATUS_SWR
    )
    return { id: service.id, name: service.name, domain: service.domain, icon: service.icon, ...health }
  }))
})
