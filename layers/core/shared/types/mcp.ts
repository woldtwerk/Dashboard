export type McpTokenScope = 'read' | 'write'

/** A token as the API lists it; the secret itself is only returned on creation. */
export interface McpTokenInfo {
  id: string
  name: string
  scope: McpTokenScope
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

/** The response of token creation: the only time the secret is visible. */
export interface CreatedMcpToken extends McpTokenInfo {
  token: string
}
