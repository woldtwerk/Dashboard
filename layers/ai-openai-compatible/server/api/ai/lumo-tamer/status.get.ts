import { defineEventHandler } from 'nuxt/server'
import { useLumoControl } from '../../../openai-compatible/lumo-control'

// Whether the Lumo proxy holds a Proton session. The proxy key never leaves the server.
export default defineEventHandler(async () => {
  const { signedIn, email, baseUrl } = await useLumoControl().status()

  return { signedIn, email, baseUrl }
})
