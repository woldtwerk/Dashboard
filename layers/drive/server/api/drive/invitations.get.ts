import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, driveServiceQuerySchema)

  return (await useDriveProvider(service)).listInvitations()
})
