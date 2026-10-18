import { createError, defineEventHandler } from 'nuxt/server'

/** The VAPID public key the browser needs to subscribe; 404 while push is not configured. */
export default defineEventHandler(() => {
  const { publicKey, privateKey, subject } = useRuntimeConfig().vapid

  if (!publicKey || !privateKey || !subject) {
    throw createError({ status: 404, statusText: 'Push notifications are not configured' })
  }

  return { publicKey }
})
