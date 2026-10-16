import { defineEventHandler, getRouterParam } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  await removeService(getRouterParam(event, 'id')!)

  return { ok: true }
})
