import { defineEventHandler, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service, path, role, password, expiration } = await readValidatedBody(event, driveShareBodySchema)

  return (await useDriveProvider(service)).setShare(path, { role, password, expiration })
})
