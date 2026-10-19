/**
 * Where an arrow key moves in a list of keys: the key to select, 'loadMore'
 * past the end, or null at the top. With no (or an unknown) current key, down
 * starts at the first row and up at the last.
 */
export function adjacentListKey(keys: string[], current: string | undefined, delta: 1 | -1): string | 'loadMore' | null {
  if (!keys.length) {
    return null
  }

  const index = current === undefined ? -1 : keys.indexOf(current)

  if (index === -1) {
    return delta > 0 ? keys[0]! : keys[keys.length - 1]!
  }

  const next = index + delta
  if (next < 0) {
    return null
  }
  if (next >= keys.length) {
    return 'loadMore'
  }
  return keys[next]!
}

/**
 * The keys an arrow key would move to from `current`: the next and the previous
 * one, so a reader can be warmed before either is selected. `loadMore` and the
 * ends of the list are not keys and are left out.
 */
export function neighbourListKeys(keys: string[], current: string | undefined): string[] {
  return ([1, -1] as const)
    .map(delta => adjacentListKey(keys, current, delta))
    .filter((key): key is string => !!key && key !== 'loadMore')
}
