import { defineEventHandler, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service, paths } = await readValidatedBody(event, drivePathsBodySchema)

  await (await useDriveProvider(service)).restore(paths)

  await invalidateDriveListings(service, affectedPaths('restore', { paths }))
  await publishDriveChanges(service, paths)
  await publishDriveTrashChange(service)

  return { ok: true }
})
