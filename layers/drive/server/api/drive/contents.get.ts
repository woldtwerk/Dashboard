import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

// Entries of a folder; `path` is a section root or a folder inside one. The
// listing is cached in the shared storage, so a revisit or a prefetch is served
// without queueing another CLI call behind the provider's lock.
export default defineEventHandler(async (event) => {
  const { service, path } = await getValidatedQuery(event, drivePathQuerySchema)

  const provider = await useDriveProvider(service)
  return await cachedList(service, path, () => provider.list(path))
})
