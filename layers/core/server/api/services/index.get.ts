import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { domain } = await getValidatedQuery(event, z.object({ domain: z.string().optional() }))

  return listServices(domain)
})
