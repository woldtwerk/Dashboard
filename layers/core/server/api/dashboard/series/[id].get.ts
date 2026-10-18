import { createError, defineEventHandler, getRouterParam, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import type { DashboardSeries } from '../../../../shared/types/dashboard'

const seriesQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30)
})

// One series with one point per bucket, oldest first
export default defineEventHandler(async (event): Promise<DashboardSeries> => {
  const { days } = await getValidatedQuery(event, seriesQuerySchema)
  const id = getRouterParam(event, 'id')
  const series = id ? await getDashboardSeries(id, days) : undefined

  if (!series) {
    throw createError({ status: 404, statusText: 'Unknown dashboard series' })
  }

  return series
})
