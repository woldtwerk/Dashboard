import { randomUUID } from 'node:crypto'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import type { CreatedAppPassword } from '../../../shared/types/app-passwords'
import { insertAppPassword } from '../../db/app-password-repository'
import { appPasswordPrefix, generateAppPassword, hashAppPassword } from '../../utils/app-passwords'

const createAppPasswordSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(['dav', 'mail'])).min(1)
})

// Creates an app password and returns it once; only its hash is stored afterwards
export default defineEventHandler(async (event): Promise<CreatedAppPassword> => {
  const { name, scopes } = await readValidatedBody(event, createAppPasswordSchema)
  const token = generateAppPassword()

  const created = await insertAppPassword(await useDb(), {
    id: randomUUID(),
    name,
    scopes: [...new Set(scopes)],
    tokenHash: hashAppPassword(token),
    prefix: appPasswordPrefix(token),
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null
  })

  return { ...created, token }
})
