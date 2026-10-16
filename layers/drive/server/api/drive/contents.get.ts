import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

// Entries of a folder; `path` is a section root or a folder inside one
export default defineEventHandler(async (event) => {
  const { service, path } = await getValidatedQuery(event, drivePathQuerySchema)

  return (await useDriveProvider(service)).list(path)
})
