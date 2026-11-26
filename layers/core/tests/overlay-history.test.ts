import { describe, expect, it } from 'vitest'
import {
  OVERLAY_BASE_KEY,
  OVERLAY_STATE_KEY,
  overlayBaseFromState,
  overlayClosePlan,
  overlayOpenState,
  overlayQueryKey,
  overlayStackFromState,
  overlayStateFor
} from '../app/utils/overlay-history'

describe('overlayStackFromState', () => {
  it('reads the stack in order', () => {
    expect(overlayStackFromState({ [OVERLAY_STATE_KEY]: ['mail', 'contact'] })).toEqual(['mail', 'contact'])
  })

  it.each([
    [null],
    [undefined],
    ['mail'],
    [{}],
    [{ [OVERLAY_STATE_KEY]: 'mail' }]
  ])('returns an empty stack for %j', (state) => {
    expect(overlayStackFromState(state)).toEqual([])
  })

  it('drops non-string entries and returns a copy', () => {
    const stack = ['mail', 1, null, 'contact', undefined]
    const result = overlayStackFromState({ [OVERLAY_STATE_KEY]: stack })

    expect(result).toEqual(['mail', 'contact'])
    expect(result).not.toBe(stack)
  })
})

describe('overlayStateFor', () => {
  it('appends the id after the existing stack', () => {
    expect(overlayStateFor(['mail', 'contact'], 'event')).toEqual({ [OVERLAY_STATE_KEY]: ['mail', 'contact', 'event'] })
  })

  it('appends a repeated id so each push keeps its depth', () => {
    expect(overlayStateFor(['mail', 'contact'], 'contact')).toEqual({ [OVERLAY_STATE_KEY]: ['mail', 'contact', 'contact'] })
  })

  it('does not mutate the input stack', () => {
    const stack = ['mail']
    const state = overlayStateFor(stack, 'contact')

    expect(stack).toEqual(['mail'])
    expect(state[OVERLAY_STATE_KEY]).not.toBe(stack)
  })
})

describe('overlayQueryKey', () => {
  it('does not depend on key order', () => {
    expect(overlayQueryKey({ a: '1', b: '2' })).toBe(overlayQueryKey({ b: '2', a: '1' }))
  })

  it('keeps array values distinct from a joined string', () => {
    expect(overlayQueryKey({ pages: ['1', '2'] })).not.toBe(overlayQueryKey({ pages: '1,2' }))
    expect(overlayQueryKey({ pages: ['1', '2'] })).not.toBe(overlayQueryKey({ pages: ['2', '1'] }))
  })

  it('differs when a value differs', () => {
    expect(overlayQueryKey({ q: 'a' })).not.toBe(overlayQueryKey({ q: 'b' }))
  })
})

describe('overlayBaseFromState', () => {
  it('reads a string base', () => {
    expect(overlayBaseFromState({ [OVERLAY_BASE_KEY]: '[[...]]' })).toBe('[[...]]')
  })

  it.each([
    [null],
    [undefined],
    ['base'],
    [{}],
    [{ [OVERLAY_BASE_KEY]: 1 }],
    [{ [OVERLAY_BASE_KEY]: ['a'] }]
  ])('ignores a non-string or missing base in %j', (state) => {
    expect(overlayBaseFromState(state)).toBeUndefined()
  })
})

describe('overlayOpenState', () => {
  it('returns the stack with the id and the base together', () => {
    expect(overlayOpenState(['mail'], 'contact', 'base')).toEqual({
      [OVERLAY_STATE_KEY]: ['mail', 'contact'],
      [OVERLAY_BASE_KEY]: 'base'
    })
  })

  it('does not mutate the input stack', () => {
    const stack = ['mail']
    overlayOpenState(stack, 'contact', 'base')

    expect(stack).toEqual(['mail'])
  })
})

describe('overlayClosePlan', () => {
  it.each([
    { name: 'unknown id', stack: ['mail'], id: 'contact', changed: false, expected: { kind: 'replace', stack: ['mail'] } },
    { name: 'top id, unchanged', stack: ['mail', 'contact'], id: 'contact', changed: false, expected: { kind: 'go', steps: 1 } },
    { name: 'top id, changed', stack: ['mail', 'contact'], id: 'contact', changed: true, expected: { kind: 'replace', stack: ['mail'] } },
    { name: 'id below a nested id', stack: ['mail', 'contact', 'event'], id: 'contact', changed: false, expected: { kind: 'go', steps: 2 } },
    { name: 'duplicate id at the top', stack: ['mail', 'contact', 'contact'], id: 'contact', changed: false, expected: { kind: 'go', steps: 1 } }
  ])('$name', ({ stack, id, changed, expected }) => {
    expect(overlayClosePlan(stack, id, changed)).toEqual(expected)
  })
})
