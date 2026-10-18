import { defineEventHandler } from 'nuxt/server'
import type { DashboardMetric } from '../../../shared/types/dashboard'

// Headline numbers of every domain, cached by the registry
export default defineEventHandler((): Promise<DashboardMetric[]> => listDashboardMetrics())
