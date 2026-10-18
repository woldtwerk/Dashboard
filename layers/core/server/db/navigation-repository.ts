import { asc } from 'drizzle-orm'
import type { Database } from './client'
import { navigationPreferences } from './schema'

export type NavigationPreferenceRow = typeof navigationPreferences.$inferSelect

export function listNavigationPreferences(db: Database): Promise<NavigationPreferenceRow[]> {
  return db.select().from(navigationPreferences).orderBy(asc(navigationPreferences.position))
}

/** Replaces every preference at once; an empty list resets to the layers' default layout */
export async function replaceNavigationPreferences(db: Database, preferences: NavigationPreferenceRow[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(navigationPreferences)
    if (preferences.length) {
      await tx.insert(navigationPreferences).values(preferences)
    }
  })
}
