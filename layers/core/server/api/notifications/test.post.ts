import { defineEventHandler } from 'nuxt/server'

/** Sends one notification in the hidden `test` category. */
export default defineEventHandler(async () => {
  const notification = await notify({
    category: 'test',
    title: 'Test notification',
    body: 'In-app and desktop notifications are working.',
    domain: 'core'
  })

  return { ok: !!notification }
})
