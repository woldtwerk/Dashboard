import { defineEventHandler } from 'nuxt/server'
import { listMcpTokens } from '../../../db/mcp-token-repository'

// Tokens as the services page lists them; hashes stay in the database
export default defineEventHandler(async () => {
  return await listMcpTokens(await useDb())
})
