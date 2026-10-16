import { defineEventHandler, getValidatedQuery } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service, path } = await getValidatedQuery(event, driveShareQuerySchema)

  await (await useDriveProvider(service)).removeShare(path)

  return { ok: true }
})
