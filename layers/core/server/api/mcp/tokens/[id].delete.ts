import { createError, defineEventHandler, getRouterParam } from 'nuxt/server'
import { revokeMcpToken } from '../../../db/mcp-token-repository'

// Revokes a token; the row stays for the list's history
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ status: 400, statusText: 'Missing token id' })
  }

  if (!await revokeMcpToken(await useDb(), id, new Date())) {
    throw createError({ status: 404, statusText: 'Token not found' })
  }

  return { ok: true }
})
