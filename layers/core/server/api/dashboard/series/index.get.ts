import { defineEventHandler } from 'nuxt/server'
import type { DashboardSeriesInfo } from '../../../../shared/types/dashboard'

// Metadata of every series; the points are fetched per series
export default defineEventHandler((): DashboardSeriesInfo[] => listDashboardSeries())
