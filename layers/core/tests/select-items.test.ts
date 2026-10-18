import { describe, expect, it } from 'vitest'

/**
 * Every exported select-item list of the app utils. Reka (Nuxt UI's select) throws
 * on an empty string value, so the sentinel of "no choice" must be a non-empty one.
 */
const modules = import.meta.glob<Record<string, unknown>>('../../*/app/utils/**/*.ts', { eager: true })

interface SelectItem {
  label?: unknown
  value?: unknown
}

function isSelectItems(value: unknown): value is SelectItem[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => !!item && typeof item === 'object' && 'value' in item)
}

interface CheckedItems {
  path: string
  name: string
  items: SelectItem[]
}

const checked: CheckedItems[] = []

for (const [path, exports] of Object.entries(modules)) {
  for (const [name, value] of Object.entries(exports)) {
    const named = /(_ITEMS|_PRESETS|Items|Presets)$/.test(name)
    if (isSelectItems(value) || (named && Array.isArray(value))) {
      checked.push({ path, name, items: value as SelectItem[] })
    }
  }
}

describe('select item constants', () => {
  it('finds the exported item lists', () => {
    expect(checked.length).toBeGreaterThan(0)
  })

  it('never uses an empty string as an item value', () => {
    const violations = checked.flatMap(({ path, name, items }) => items
      .filter(item => item.value === '')
      .map(item => `${path} ${name}: ${JSON.stringify(item)}`))

    expect(violations).toEqual([])
  })
})
