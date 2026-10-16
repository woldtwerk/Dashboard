import { defineEventHandler } from 'nuxt/server'

// Index status per mail service; null without a search index
export default defineEventHandler(async () => {
  if (!useMailSearchIndex()) {
    return null
  }

  const services = await listServices('mail')
  return Promise.all(services.map(service => getMailIndexStatus(service.id)))
})
