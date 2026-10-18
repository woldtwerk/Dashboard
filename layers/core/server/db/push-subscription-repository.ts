import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { Database } from './client'
import { pushSubscriptions } from './schema'

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect

export interface PushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string
  userId?: string
}

export function listSubscriptions(db: Database): Promise<PushSubscriptionRow[]> {
  return db.select().from(pushSubscriptions).orderBy(asc(pushSubscriptions.createdAt))
}

/** Inserts by endpoint or refreshes the keys of an existing browser subscription. */
export async function upsertSubscription(db: Database, input: PushSubscriptionInput): Promise<PushSubscriptionRow> {
  const [saved] = await db.insert(pushSubscriptions)
    .values({
      id: randomUUID(),
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
      userId: input.userId ?? null,
      createdAt: new Date()
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
        userId: input.userId ?? null
      }
    })
    .returning()

  return saved!
}

/** @returns the deleted subscription, if it existed */
export async function deleteSubscription(db: Database, endpoint: string): Promise<PushSubscriptionRow | undefined> {
  const [deleted] = await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).returning()
  return deleted
}
