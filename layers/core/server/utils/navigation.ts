import { z } from 'zod'
import type { NavigationPreference } from '../../shared/types/navigation'
import { listNavigationPreferences, replaceNavigationPreferences } from '../db/navigation-repository'

/** Upper bound on stored entries; the sidebar has far fewer */
export const NAVIGATION_MAX_ENTRIES = 50

export const navigationPreferencesSchema = z.array(z.object({
  key: z.string().regex(/^[a-z0-9-]{1,40}$/, 'Invalid key'),
  label: z.string().trim().min(1).max(40).nullable(),
  position: z.number().int().min(0).max(999)
}))
  .max(NAVIGATION_MAX_ENTRIES)
  .refine(preferences => new Set(preferences.map(preference => preference.key)).size === preferences.length, {
    message: 'Keys must be unique'
  })

export async function getNavigationPreferences(): Promise<NavigationPreference[]> {
  return listNavigationPreferences(await useDb())
}

export async function saveNavigationPreferences(preferences: NavigationPreference[]): Promise<NavigationPreference[]> {
  await replaceNavigationPreferences(await useDb(), preferences)
  return preferences
}

export async function resetNavigationPreferences(): Promise<NavigationPreference[]> {
  await replaceNavigationPreferences(await useDb(), [])
  return []
}
