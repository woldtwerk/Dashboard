import { defineEventHandler, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service } = await readValidatedBody(event, driveEmptyTrashBodySchema)

  await (await useDriveProvider(service)).emptyTrash()

  return { ok: true }
})
