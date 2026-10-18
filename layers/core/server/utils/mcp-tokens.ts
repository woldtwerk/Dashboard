import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** Marks a value as an Allmight MCP token, so it is recognizable in a paste. */
export const MCP_TOKEN_PREFIX = 'amcp_'

/** 32 random bytes, base64url encoded; shown to the user exactly once. */
export function generateMcpToken(): string {
  return `${MCP_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

/** The only form a token is stored in. */
export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison of a presented token with a stored hash. */
export function mcpTokenMatchesHash(token: string, storedHash: string): boolean {
  const presented = Buffer.from(hashMcpToken(token), 'hex')
  const stored = Buffer.from(storedHash, 'hex')

  return presented.length === stored.length && timingSafeEqual(presented, stored)
}

/** The token of an `Authorization: Bearer <token>` header, if it is well formed. */
export function parseBearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(\S{1,200})$/i)
  return match?.[1]
}
