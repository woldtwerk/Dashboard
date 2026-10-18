import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import type { AuthUser } from '../../../shared/types/auth'
import { countUsers, createUser } from '../../db/user-repository'

const setupSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(200)
})

// First account only. The lock keeps two workers from creating it twice; the
// count is re-checked inside the lock and the unique email index is the last guard.
export default defineEventHandler(async (event): Promise<AuthUser> => {
  const { email, name, password } = await readValidatedBody(event, setupSchema)

  const created = await withLock('auth-setup', 30_000, async (): Promise<AuthUser | undefined> => {
    const db = await useDb()
    if (await countUsers(db) > 0) {
      return undefined
    }

    const user = await createUser(db, { email, name, password })
    await setUserSession(event, {
      user,
      loggedInAt: new Date().toISOString()
    })
    return user
  })

  if (!created) {
    throw createError({ statusCode: 409, statusMessage: 'An account already exists' })
  }

  return created
})
