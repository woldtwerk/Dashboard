import { defineEventHandler, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service, paths } = await readValidatedBody(event, drivePathsBodySchema)

  await (await useDriveProvider(service)).trash(paths)

  return { ok: true }
})
