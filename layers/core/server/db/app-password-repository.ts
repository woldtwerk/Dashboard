import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import type { AppPasswordInfo, AppPasswordScope } from '../../shared/types/app-passwords'
import type { Database } from './client'
import { appPasswords } from './schema'

export interface AppPasswordRow {
  id: string
  name: string
  scopes: AppPasswordScope[]
  tokenHash: string
  prefix: string
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

const toInfo = (row: AppPasswordRow): AppPasswordInfo => ({
  id: row.id,
  name: row.name,
  scopes: row.scopes,
  prefix: row.prefix,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null
})

/** Every app password, newest first; hashes never leave the repository. */
export async function listAppPasswords(db: Database): Promise<AppPasswordInfo[]> {
  const rows = await db.select().from(appPasswords).orderBy(desc(appPasswords.createdAt))

  return rows.map(toInfo)
}

export async function insertAppPassword(db: Database, row: AppPasswordRow): Promise<AppPasswordInfo> {
  const [created] = await db.insert(appPasswords).values(row).returning()

  return toInfo(created as AppPasswordRow)
}

/** The row a hash belongs to, including revoked ones, so the caller can reject them. */
export async function findAppPasswordByHash(db: Database, tokenHash: string): Promise<AppPasswordRow | undefined> {
  return await db.select().from(appPasswords).where(eq(appPasswords.tokenHash, tokenHash)).get() as AppPasswordRow | undefined
}

export async function revokeAppPassword(db: Database, id: string, revokedAt: Date): Promise<boolean> {
  const rows = await db.update(appPasswords)
    .set({ revokedAt })
    .where(and(eq(appPasswords.id, id), isNull(appPasswords.revokedAt)))
    .returning({ id: appPasswords.id })

  return rows.length > 0
}

/**
 * Records a use, but at most once per minute of the row's own timestamp. The
 * condition is part of the UPDATE, so concurrent workers cannot both age it.
 */
export async function touchAppPassword(db: Database, id: string, now: Date, minIntervalMs = 60_000): Promise<void> {
  const cutoff = new Date(now.getTime() - minIntervalMs)

  await db.update(appPasswords)
    .set({ lastUsedAt: now })
    .where(and(
      eq(appPasswords.id, id),
      or(isNull(appPasswords.lastUsedAt), lt(appPasswords.lastUsedAt, cutoff))
    ))
}
