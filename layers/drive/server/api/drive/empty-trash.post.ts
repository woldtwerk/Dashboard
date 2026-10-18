import { defineEventHandler, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await readValidatedBody(event, driveEmptyTrashBodySchema)

  await (await useDriveProvider(service)).emptyTrash()

  await invalidateDriveListings(service, affectedPaths('empty-trash', {}))
  await publishDriveTrashChange(service)

  return { ok: true }
})
