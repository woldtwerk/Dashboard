import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { parentPath } from '../../../shared/drive-path'

export default defineEventHandler(async (event) => {
  const { service, path, name } = await readValidatedBody(event, driveRenameBodySchema)

  await (await useDriveProvider(service)).rename(path, name)

  await invalidateDriveListings(service, affectedPaths('rename', { path }))
  await publishDriveChange(service, parentPath(path))

  return { ok: true }
})
