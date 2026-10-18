import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import type { McpTokenInfo, McpTokenScope } from '../../shared/types/mcp'
import type { Database } from './client'
import { mcpTokens } from './schema'

export interface McpTokenRow {
  id: string
  name: string
  tokenHash: string
  scope: McpTokenScope
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

const toInfo = (row: McpTokenRow): McpTokenInfo => ({
  id: row.id,
  name: row.name,
  scope: row.scope,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null
})

/** Every token, newest first; hashes never leave the repository. */
export async function listMcpTokens(db: Database): Promise<McpTokenInfo[]> {
  const rows = await db.select().from(mcpTokens).orderBy(desc(mcpTokens.createdAt))

  return rows.map(toInfo)
}

export async function insertMcpToken(db: Database, row: McpTokenRow): Promise<McpTokenInfo> {
  const [created] = await db.insert(mcpTokens).values(row).returning()

  return toInfo(created as McpTokenRow)
}

/** The token a hash belongs to, including revoked ones, so the caller can reject them. */
export async function findMcpTokenByHash(db: Database, tokenHash: string): Promise<McpTokenRow | undefined> {
  return await db.select().from(mcpTokens).where(eq(mcpTokens.tokenHash, tokenHash)).get() as McpTokenRow | undefined
}

export async function revokeMcpToken(db: Database, id: string, revokedAt: Date): Promise<boolean> {
  const rows = await db.update(mcpTokens)
    .set({ revokedAt })
    .where(and(eq(mcpTokens.id, id), isNull(mcpTokens.revokedAt)))
    .returning({ id: mcpTokens.id })

  return rows.length > 0
}

/**
 * Records a use, but at most once per minute of the row's own timestamp. The
 * condition is part of the UPDATE, so concurrent workers cannot both age it.
 */
export async function touchMcpToken(db: Database, id: string, now: Date, minIntervalMs = 60_000): Promise<void> {
  const cutoff = new Date(now.getTime() - minIntervalMs)

  await db.update(mcpTokens)
    .set({ lastUsedAt: now })
    .where(and(
      eq(mcpTokens.id, id),
      or(isNull(mcpTokens.lastUsedAt), lt(mcpTokens.lastUsedAt, cutoff))
    ))
}
