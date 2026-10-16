import { createError, defineEventHandler, getValidatedQuery } from 'nuxt/server'

// Starts a full index sync of one service in the background
export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, serviceQuerySchema)
  if (!useMailSearchIndex()) {
    throw createError({ status: 404, statusText: 'No search index configured' })
  }

  await getService(service, 'mail')
  syncMailService(service).catch((error) => {
    console.error(`[mail] Index sync of ${service} failed:`, error)
  })

  return { started: true }
})
