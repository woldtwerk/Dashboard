import { asc, eq } from 'drizzle-orm'
import type { Database } from './client'
import { services } from './schema'

export type ServiceRow = typeof services.$inferSelect

export function findServices(db: Database, domain?: string): Promise<ServiceRow[]> {
  return db.select().from(services)
    .where(domain ? eq(services.domain, domain) : undefined)
    .orderBy(asc(services.createdAt))
}

export async function findService(db: Database, id: string): Promise<ServiceRow | undefined> {
  return db.select().from(services).where(eq(services.id, id)).get()
}

/** Inserts or updates; keeps `createdAt` of an existing service */
export async function upsertService(db: Database, row: Omit<ServiceRow, 'createdAt' | 'updatedAt'>): Promise<ServiceRow> {
  const now = new Date()
  const [saved] = await db.insert(services)
    .values({ ...row, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: services.id,
      set: { name: row.name, icon: row.icon, settings: row.settings, updatedAt: now }
    })
    .returning()

  return saved!
}

/** @returns the deleted service, if it existed */
export async function deleteService(db: Database, id: string): Promise<ServiceRow | undefined> {
  const [deleted] = await db.delete(services).where(eq(services.id, id)).returning()
  return deleted
}
