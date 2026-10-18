import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'

const uidSchema = z.string().min(1).max(512).refine(uid => !hasControlChars(uid), 'The invitation id is invalid')

export default defineEventHandler(async (event) => {
  const uid = uidSchema.parse(getRouterParam(event, 'uid'))
  const { service, accept } = await readValidatedBody(event, driveInvitationBodySchema)

  if (!uid) {
    throw createError({ status: 400, statusText: 'The invitation id is missing' })
  }

  await (await useDriveProvider(service)).setInvitation(uid, accept)

  // Accepting adds the folder to "Shared with me", so that listing is invalidated
  const affected = affectedPaths('invitation-accept', { accept })
  await invalidateDriveListings(service, affected)
  for (const resource of affected) {
    await publishDriveChange(service, resource)
  }

  return { ok: true }
})
