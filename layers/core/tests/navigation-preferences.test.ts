import { describe, expect, it } from 'vitest'
import { applyNavigationPreferences, isDefaultLayout, moveEntry, toPreferences } from '../app/utils/navigation-preferences'
import type { NavigationPreference } from '../shared/types/navigation'

const entry = (key: string, order: number, label = key) => ({ key, label, order })
const preference = (key: string, position: number, label: string | null = null): NavigationPreference => ({ key, label, position })

const defaults = [
  entry('home', 0, 'Home'),
  entry('mail', 10, 'Mail'),
  entry('calendar', 20, 'Calendar')
]

describe('applyNavigationPreferences', () => {
  it('keeps the default order and labels without preferences', () => {
    expect(applyNavigationPreferences(defaults, []).map(item => item.key)).toEqual(['home', 'mail', 'calendar'])
    expect(applyNavigationPreferences(defaults, [])[1]).toMatchObject({ label: 'Mail', defaultLabel: 'Mail' })
  })

  it('orders remembered entries by position and overrides their labels', () => {
    const applied = applyNavigationPreferences(defaults, [
      preference('calendar', 0),
      preference('home', 1, 'Start'),
      preference('mail', 2)
    ])

    expect(applied.map(item => item.key)).toEqual(['calendar', 'home', 'mail'])
    expect(applied[1]).toMatchObject({ label: 'Start', defaultLabel: 'Home' })
  })

  it('ignores preferences for keys that no longer exist', () => {
    const applied = applyNavigationPreferences(defaults, [preference('gone', 0), preference('mail', 1)])

    expect(applied.map(item => item.key)).toEqual(['home', 'mail', 'calendar'])
  })

  it('inserts a new entry after the last remembered entry whose default order precedes it', () => {
    const withDrive = [...defaults, entry('drive', 15, 'Drive')]
    const applied = applyNavigationPreferences(withDrive, [
      preference('calendar', 0),
      preference('home', 1),
      preference('mail', 2)
    ])

    expect(applied.map(item => item.key)).toEqual(['calendar', 'home', 'mail', 'drive'])
  })

  it('puts a new entry first when no remembered entry precedes it', () => {
    const withFirst = [entry('alpha', -5, 'Alpha'), ...defaults]
    const applied = applyNavigationPreferences(withFirst, [preference('home', 0), preference('mail', 1)])

    expect(applied.map(item => item.key)).toEqual(['alpha', 'home', 'mail', 'calendar'])
  })

  it('keeps the default order of several new entries in the same gap', () => {
    const withNew = [...defaults, entry('drive', 12, 'Drive'), entry('photos', 14, 'Photos')]
    const applied = applyNavigationPreferences(withNew, [preference('home', 0), preference('mail', 1), preference('calendar', 2)])

    expect(applied.map(item => item.key)).toEqual(['home', 'mail', 'drive', 'photos', 'calendar'])
  })
})

describe('moveEntry', () => {
  const keys = ['a', 'b', 'c']

  it('moves an entry to another index', () => {
    expect(moveEntry(keys, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveEntry(keys, 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('returns a copy for a no-op or an out-of-range move', () => {
    expect(moveEntry(keys, 1, 1)).toEqual(keys)
    expect(moveEntry(keys, -1, 1)).toEqual(keys)
    expect(moveEntry(keys, 0, 3)).toEqual(keys)
    expect(moveEntry(keys, 0, 1)).not.toBe(keys)
  })
})

describe('toPreferences', () => {
  it('numbers the entries in their current order', () => {
    const preferences = toPreferences([
      { key: 'b', label: 'Bee', defaultLabel: 'Bee' },
      { key: 'a', label: 'Aye', defaultLabel: 'Aye' }
    ])

    expect(preferences).toEqual([{ key: 'b', label: null, position: 0 }, { key: 'a', label: null, position: 1 }])
  })

  it('stores a label only when it differs from the default and drops an empty one', () => {
    expect(toPreferences([
      { key: 'a', label: 'Start', defaultLabel: 'Home' },
      { key: 'b', label: '', defaultLabel: 'Mail' }
    ])).toEqual([{ key: 'a', label: 'Start', position: 0 }, { key: 'b', label: null, position: 1 }])
  })
})

describe('isDefaultLayout', () => {
  const applied = applyNavigationPreferences(defaults, [])

  it('is true for the default order and labels', () => {
    expect(isDefaultLayout(applied, defaults)).toBe(true)
  })

  it('is false when the order changed', () => {
    expect(isDefaultLayout([applied[2]!, applied[0]!, applied[1]!], defaults)).toBe(false)
  })

  it('is false when a label was changed', () => {
    expect(isDefaultLayout([{ ...applied[0]!, label: 'Start' }, applied[1]!, applied[2]!], defaults)).toBe(false)
  })
})
