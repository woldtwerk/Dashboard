import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import { useLogsStore } from '../../utils/service-logger'

const activityQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14)
})

export default defineEventHandler(async (event) => {
  const { days } = await getValidatedQuery(event, activityQuerySchema)
  const store = await useLogsStore()

  return await store.activity(days)
})
