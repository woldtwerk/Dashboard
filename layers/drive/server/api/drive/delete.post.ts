import { defineEventHandler, readValidatedBody } from 'nuxt/server'

// Permanently removes entries; this bypasses the trash and cannot be undone
export default defineEventHandler(async (event) => {
  const { service, paths } = await readValidatedBody(event, drivePathsBodySchema)

  await (await useDriveProvider(service)).remove(paths)

  await invalidateDriveListings(service, affectedPaths('delete', { paths }))
  await publishDriveChanges(service, paths)

  return { ok: true }
})
