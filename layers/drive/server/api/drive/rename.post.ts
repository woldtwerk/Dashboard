import { defineEventHandler, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service, path, name } = await readValidatedBody(event, driveRenameBodySchema)

  await (await useDriveProvider(service)).rename(path, name)

  return { ok: true }
})
