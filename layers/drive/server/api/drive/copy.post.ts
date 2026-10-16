import { defineEventHandler, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service, paths, target, name } = await readValidatedBody(event, driveCopyBodySchema)

  await (await useDriveProvider(service)).copy(paths, target, name)

  return { ok: true }
})
