import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, serviceQuerySchema)

  return (await useMailProvider(service)).listMailboxes()
})
