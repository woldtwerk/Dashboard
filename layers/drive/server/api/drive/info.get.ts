import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service, path } = await getValidatedQuery(event, drivePathQuerySchema)

  return (await useDriveProvider(service)).info(path)
})
