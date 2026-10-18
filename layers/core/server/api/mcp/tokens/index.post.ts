import { randomUUID } from 'node:crypto'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import type { CreatedMcpToken } from '../../../../shared/types/mcp'
import { insertMcpToken } from '../../../db/mcp-token-repository'
import { generateMcpToken, hashMcpToken } from '../../../utils/mcp-tokens'

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(['read', 'write'])
})

// Creates a token and returns it once; only its hash is stored afterwards
export default defineEventHandler(async (event): Promise<CreatedMcpToken> => {
  const { name, scope } = await readValidatedBody(event, createTokenSchema)
  const token = generateMcpToken()

  const created = await insertMcpToken(await useDb(), {
    id: randomUUID(),
    name,
    tokenHash: hashMcpToken(token),
    scope,
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null
  })

  return { ...created, token }
})
