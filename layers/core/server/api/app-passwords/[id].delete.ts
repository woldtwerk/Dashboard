import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { revokeAppPassword } from '../../db/app-password-repository'

// Revokes an app password; the row stays for the list's history
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ status: 400, statusText: 'Missing app password id' })
  }

  if (!await revokeAppPassword(await useDb(), id, new Date())) {
    throw createError({ status: 404, statusText: 'App password not found' })
  }

  return { ok: true }
})
