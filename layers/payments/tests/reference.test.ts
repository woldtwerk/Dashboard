import { describe, expect, it } from 'vitest'
import { createReference, findReference, normalizeReference } from '../shared/reference'

describe('createReference', () => {
  it('maps six random bytes onto the Crockford alphabet', () => {
    const reference = createReference((bytes) => {
      bytes.set([0, 1, 2, 3, 4, 5])
      return bytes
    })

    expect(reference).toBe('AM-012345')
  })

  it('never emits I, L, O or U', () => {
    for (let run = 0; run < 100; run++) {
      expect(createReference()).toMatch(/^AM-[0-9A-HJKMNP-TV-Z]{6}$/)
    }
  })
})

describe('findReference', () => {
  it.each([
    ['please pay am-7k3q9x', 'AM-7K3Q9X'],
    ['AM 7K3Q9X', 'AM-7K3Q9X'],
    ['am7k3q9x', 'AM-7K3Q9X'],
    ['Referenz: AM-OI3Q9X', 'AM-013Q9X'],
    ['am-l23q9x', 'AM-123Q9X']
  ])('finds %s', (text, expected) => {
    expect(findReference(text)).toBe(expected)
  })

  it.each([
    ['a word that starts with AM', 'AMSTERDAM'],
    ['a longer token', 'AM-7K3Q9X1'],
    ['a U outside the alphabet', 'AM-7K3Q9U'],
    ['unrelated text', 'payment for dinner 17,99']
  ])('does not mistake %s for a reference', (_name, text) => {
    expect(findReference(text)).toBeUndefined()
  })
})

describe('normalizeReference', () => {
  it('canonicalizes spacing, case and look-alikes', () => {
    expect(normalizeReference(' am 7k3q9x ')).toBe('AM-7K3Q9X')
    expect(normalizeReference('AM-OI3Q9X')).toBe('AM-013Q9X')
  })

  it('rejects anything that is not a reference', () => {
    expect(normalizeReference('AM-7K3Q9U')).toBeUndefined()
    expect(normalizeReference('AM-7K3Q9')).toBeUndefined()
  })
})
