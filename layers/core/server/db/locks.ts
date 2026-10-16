import { randomUUID } from 'node:crypto'
import { and, eq, lt, sql } from 'drizzle-orm'
import type { Database } from './client'
import { locks } from './schema'

export interface Lock {
  name: string
  owner: string
}

/**
 * Takes the named lease unless another owner holds an unexpired one.
 * Works across cluster workers, because the database decides.
 */
export async function acquireLock(db: Database, name: string, ttlMs: number, owner: string = randomUUID()): Promise<Lock | undefined> {
  const now = Date.now()
  const taken = await db.insert(locks)
    .values({ name, owner, expiresAt: new Date(now + ttlMs) })
    .onConflictDoUpdate({
      target: locks.name,
      set: { owner, expiresAt: new Date(now + ttlMs) },
      // Only steal an expired lease
      setWhere: lt(locks.expiresAt, new Date(now))
    })
    .returning({ owner: locks.owner })

  return taken[0]?.owner === owner ? { name, owner } : undefined
}

/** Extends a held lease; false if it was lost (expired and taken over) */
export async function renewLock(db: Database, lock: Lock, ttlMs: number): Promise<boolean> {
  const renewed = await db.update(locks)
    .set({ expiresAt: new Date(Date.now() + ttlMs) })
    .where(and(eq(locks.name, lock.name), eq(locks.owner, lock.owner)))
    .returning({ name: locks.name })

  return renewed.length > 0
}

export async function releaseLock(db: Database, lock: Lock): Promise<void> {
  await db.delete(locks).where(and(eq(locks.name, lock.name), eq(locks.owner, lock.owner)))
}

export async function isLocked(db: Database, name: string): Promise<boolean> {
  const row = await db.select({ count: sql<number>`count(*)` }).from(locks)
    .where(and(eq(locks.name, name), sql`${locks.expiresAt} >= ${Date.now()}`))
    .get()

  return (row?.count ?? 0) > 0
}
