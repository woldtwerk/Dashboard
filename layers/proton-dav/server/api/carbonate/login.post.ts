import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { useCarbonateControl } from '../../carbonate/control'

// Signs a Proton account in to the carbonate container. The Proton password is
// passed through, never stored; the response holds the DAV credentials the
// service will keep, encrypted.
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    username: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(1024),
    mailboxPassword: z.string().max(1024).optional(),
    totp: z.string().trim().max(16).optional(),
    verificationToken: z.string().trim().max(4096).optional()
  }))
  const { account, dav } = await useCarbonateControl().login(body)

  return { account, url: dav.url, username: dav.username, password: dav.password }
})
