import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { toBridgeValues } from '../../../proton/bridge-account'
import { useBridgeControl } from '../../../proton/bridge-control'

// Signs a Proton account in to the Bridge container. The Proton password is passed through, never stored;
// the response holds the service values without the IMAP password.
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    username: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(1024),
    totp: z.string().trim().max(16).optional(),
    mailboxPassword: z.string().max(1024).optional()
  }))
  const bridge = useBridgeControl()

  return toBridgeValues(await bridge.login(body), bridge.url)
})
