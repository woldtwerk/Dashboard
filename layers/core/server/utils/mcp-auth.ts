import type { McpTokenScope } from '../../shared/types/mcp'
import { findMcpTokenByHash, touchMcpToken } from '../db/mcp-token-repository'
import { hashMcpToken, mcpTokenMatchesHash, parseBearerToken } from './mcp-tokens'

export interface McpTokenAuth {
  id: string
  name: string
  scope: McpTokenScope
}

/**
 * Resolves an Authorization header to a live token. Revoked, unknown and
 * malformed tokens all resolve to `undefined`, so the caller answers 401
 * without revealing which case it was.
 */
export async function authenticateMcpToken(header: string | string[] | undefined): Promise<McpTokenAuth | undefined> {
  const token = parseBearerToken(Array.isArray(header) ? header[0] : header)
  if (!token) {
    return undefined
  }

  const db = await useDb()
  const row = await findMcpTokenByHash(db, hashMcpToken(token))
  if (!row || row.revokedAt || !mcpTokenMatchesHash(token, row.tokenHash)) {
    return undefined
  }

  await touchMcpToken(db, row.id, new Date())

  return { id: row.id, name: row.name, scope: row.scope }
}
