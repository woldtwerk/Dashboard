import { defineEventHandler } from 'nuxt/server'
import type { ServiceStatus } from '../../../shared/types/dashboard'

// Every configured service with the health its domain source reports
export default defineEventHandler(async (): Promise<ServiceStatus[]> => {
  const services = await listServices()
  return Promise.all(services.map(service => dashboardServiceStatus(service)))
})
