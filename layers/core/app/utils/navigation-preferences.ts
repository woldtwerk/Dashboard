import type { NavigationPreference } from '../../shared/types/navigation'

/** Order used when a layer does not set one */
export const DEFAULT_NAVIGATION_ORDER = 100

/** An entry as a layer registers it; `label` is then the layer's default */
export interface NavigationPreferenceEntry {
  key: string
  label: string
  order?: number
  /** Set once preferences were applied; `label` is then the effective one */
  defaultLabel?: string
}

const orderOf = (entry: NavigationPreferenceEntry) => entry.order ?? DEFAULT_NAVIGATION_ORDER

/**
 * Applies the stored order and labels. Remembered entries come first, in their saved
 * order; an entry without a preference (a newly installed layer) keeps its layer's
 * place, right after the last remembered entry whose default order precedes it.
 * Preferences for keys that no longer exist are ignored.
 */
export function applyNavigationPreferences<T extends NavigationPreferenceEntry>(
  entries: T[],
  preferences: NavigationPreference[]
): Array<T & { defaultLabel: string }> {
  const byKey = new Map(preferences.map(preference => [preference.key, preference]))

  const applied = entries.map((entry) => {
    const preference = byKey.get(entry.key)
    const defaultLabel = entry.defaultLabel ?? entry.label

    return { ...entry, label: preference?.label ?? defaultLabel, defaultLabel }
  })

  const remembered = applied
    .filter(entry => byKey.has(entry.key))
    .sort((a, b) => byKey.get(a.key)!.position - byKey.get(b.key)!.position)

  // New entries are grouped by the remembered entry they follow; `-1` means before all of them
  const groups = new Map<number, Array<T & { defaultLabel: string }>>()
  for (const entry of applied.filter(entry => !byKey.has(entry.key)).sort((a, b) => orderOf(a) - orderOf(b))) {
    const anchor = remembered.reduce((found, item, index) => orderOf(item) < orderOf(entry) ? index : found, -1)
    groups.set(anchor, [...(groups.get(anchor) ?? []), entry])
  }

  return [
    ...(groups.get(-1) ?? []),
    ...remembered.flatMap((entry, index) => [entry, ...(groups.get(index) ?? [])])
  ]
}

/** Moves one entry; an out-of-range or no-op move returns the list unchanged */
export function moveEntry<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) {
    return [...items]
  }

  const moved = [...items]
  const [entry] = moved.splice(from, 1)
  moved.splice(to, 0, entry!)

  return moved
}

/** Positions 0..n in the current order, with labels only where they differ from the default */
export function toPreferences(entries: Array<{ key: string, label: string, defaultLabel: string }>): NavigationPreference[] {
  return entries.map((entry, position) => ({
    key: entry.key,
    label: entry.label && entry.label !== entry.defaultLabel ? entry.label : null,
    position
  }))
}

/** Whether the list is exactly the layer's default order and labels */
export function isDefaultLayout(
  entries: Array<{ key: string, label: string }>,
  defaults: NavigationPreferenceEntry[]
): boolean {
  const expected = [...defaults].sort((a, b) => orderOf(a) - orderOf(b))

  return entries.length === expected.length && entries.every((entry, index) => {
    const fallback = expected[index]
    return !!fallback && entry.key === fallback.key && entry.label === fallback.label
  })
}
