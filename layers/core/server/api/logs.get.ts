import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { logQuerySchema } from '../logs/query'
import { useLogsStore } from '../utils/service-logger'

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, logQuerySchema)
  const store = await useLogsStore()

  return await store.query(query)
})
