import { describe, expect, it } from 'vitest'
import { isChordContinuation } from '../app/utils/shortcut-chords'

describe('isChordContinuation', () => {
  it.each([
    ['within the chord window', 1_100, true],
    ['after the chord window', 4_000, false]
  ])('handles the gap between g and a %s', (_name, at, expected) => {
    expect(isChordContinuation('a', { previous: 'g', previousAt: 1_000, current: 'a', at })).toBe(expected)
  })

  it('ignores a key that did not follow the chord start', () => {
    expect(isChordContinuation('a', { previous: 'x', previousAt: 1_000, current: 'a', at: 1_100 })).toBe(false)
    expect(isChordContinuation('f', { previous: 'g', previousAt: 1_000, current: 'a', at: 1_100 })).toBe(false)
  })
})
