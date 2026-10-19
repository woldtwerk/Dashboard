import { describe, expect, it } from 'vitest'
import { adjacentListKey, neighbourListKeys } from '../app/utils/mail-list-navigation'

const keys = ['a', 'b', 'c']

describe('adjacentListKey', () => {
  it('starts at the first key going down without a selection', () => {
    expect(adjacentListKey(keys, undefined, 1)).toBe('a')
  })

  it('starts at the last key going up without a selection', () => {
    expect(adjacentListKey(keys, undefined, -1)).toBe('c')
  })

  it('starts at the first/last key when the current key is not in the list', () => {
    expect(adjacentListKey(keys, 'missing', 1)).toBe('a')
    expect(adjacentListKey(keys, 'missing', -1)).toBe('c')
  })

  it('moves to the next key', () => {
    expect(adjacentListKey(keys, 'a', 1)).toBe('b')
    expect(adjacentListKey(keys, 'b', 1)).toBe('c')
  })

  it('moves to the previous key', () => {
    expect(adjacentListKey(keys, 'c', -1)).toBe('b')
    expect(adjacentListKey(keys, 'b', -1)).toBe('a')
  })

  it('has nowhere to go above the first key', () => {
    expect(adjacentListKey(keys, 'a', -1)).toBeNull()
  })

  it('asks for more past the last key', () => {
    expect(adjacentListKey(keys, 'c', 1)).toBe('loadMore')
  })

  it('has nothing at all without keys', () => {
    expect(adjacentListKey([], undefined, 1)).toBeNull()
    expect(adjacentListKey([], undefined, -1)).toBeNull()
  })

  it('handles a single key', () => {
    expect(adjacentListKey(['only'], 'only', 1)).toBe('loadMore')
    expect(adjacentListKey(['only'], 'only', -1)).toBeNull()
  })
})

describe('neighbourListKeys', () => {
  it('returns the keys on both sides of the current one', () => {
    expect(neighbourListKeys(keys, 'b')).toEqual(['c', 'a'])
  })

  it('leaves out the end past which the list has to load more', () => {
    expect(neighbourListKeys(keys, 'c')).toEqual(['b'])
  })

  it('leaves out the top of the list', () => {
    expect(neighbourListKeys(keys, 'a')).toEqual(['b'])
  })

  it('warms the ends when nothing is selected yet', () => {
    expect(neighbourListKeys(keys, undefined)).toEqual(['a', 'c'])
  })

  it('has nothing to warm without keys', () => {
    expect(neighbourListKeys([], undefined)).toEqual([])
  })

  it('has nothing to warm for a single key', () => {
    expect(neighbourListKeys(['only'], 'only')).toEqual([])
  })
})
