import { defineEventHandler } from 'nuxt/server'
import { useLumoControl } from '../../../openai-compatible/lumo-control'

// Signs the account out of the Lumo proxy container; the proxy stops.
export default defineEventHandler(async () => {
  await useLumoControl().logout()

  return { ok: true }
})
