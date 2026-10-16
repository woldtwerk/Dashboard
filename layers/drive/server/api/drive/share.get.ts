import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service, path } = await getValidatedQuery(event, driveShareQuerySchema)

  return (await useDriveProvider(service)).share(path)
})
