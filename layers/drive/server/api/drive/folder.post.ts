import { defineEventHandler, readValidatedBody } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const { service, path, name } = await readValidatedBody(event, driveFolderBodySchema)

  await (await useDriveProvider(service)).createFolder(path, name)
  await publishDriveChange(service, path)

  return { ok: true }
})
