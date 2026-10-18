import { defineEventHandler } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  await clearUserSession(event)

  return { ok: true }
})
