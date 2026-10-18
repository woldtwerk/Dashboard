import { getRequestHeader, getRequestIP, setResponseHeader } from 'h3'
import type { H3Event } from 'h3'
import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { findUserByEmail } from '../../db/user-repository'
import { checkLogin, dummyPasswordHash } from '../../utils/auth-login'
import { clientIp, loginAttemptState, readLoginAttempts, registerLoginFailure, resetLoginEmail } from '../../utils/auth-rate-limit'

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200)
})

export default defineEventHandler(async (event) => {
  // Nuxt's portable RequestEvent is narrower than the h3 v1 event the runtime passes
  const h3Event = event as unknown as H3Event
  const { email, password } = await readValidatedBody(event, loginSchema)
  const normalizedEmail = email.trim().toLowerCase()
  const ip = clientIp(getRequestHeader(h3Event, 'x-forwarded-for'), getRequestIP(h3Event))
  const now = Date.now()

  const attempts = await readLoginAttempts(ip, normalizedEmail)
  const blocked = [attempts.ip, attempts.email]
    .map(attempt => loginAttemptState(attempt, now))
    .reduce((worst, state) => state.retryAfterSeconds > worst.retryAfterSeconds ? state : worst)

  if (blocked.blocked) {
    setResponseHeader(h3Event, 'Retry-After', blocked.retryAfterSeconds)
    throw createError({
      statusCode: 429,
      statusMessage: `Too many attempts, try again in ${Math.ceil(blocked.retryAfterSeconds / 60)} min`
    })
  }

  const account = await findUserByEmail(await useDb(), normalizedEmail)
  const result = await checkLogin({ account, password, verify: verifyPassword, dummyHash: dummyPasswordHash })

  if (!result.ok) {
    await registerLoginFailure(ip, normalizedEmail, now)
    throw createError({ statusCode: result.statusCode, statusMessage: result.statusMessage })
  }

  const user = result.account
  await resetLoginEmail(normalizedEmail)
  await setUserSession(event, {
    user: { id: user.id, email: user.email, name: user.name },
    loggedInAt: new Date().toISOString()
  })

  return { id: user.id, email: user.email, name: user.name }
})
