import { defineEventHandler, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service, paths, target } = await readValidatedBody(event, driveMoveBodySchema)

  await (await useDriveProvider(service)).move(paths, target)

  await invalidateDriveListings(service, affectedPaths('move', { paths, target }))
  await publishDriveChanges(service, paths)
  await publishDriveChange(service, target)

  return { ok: true }
})
