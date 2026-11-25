import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { toLumoValues, useLumoControl } from '../../../openai-compatible/lumo-control'

// Signs a Proton account in to the Lumo proxy container. The Proton password is passed through, never stored;
// the response holds the proxy's service values, so the wizard stores the service without the user typing the key.
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    email: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(1024),
    totp: z.string().trim().max(16).optional()
  }))
  const tamer = useLumoControl()

  return toLumoValues(await tamer.login(body))
})
