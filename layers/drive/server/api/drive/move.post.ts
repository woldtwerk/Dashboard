import { defineEventHandler, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service, paths, target } = await readValidatedBody(event, driveMoveBodySchema)

  await (await useDriveProvider(service)).move(paths, target)

  return { ok: true }
})
