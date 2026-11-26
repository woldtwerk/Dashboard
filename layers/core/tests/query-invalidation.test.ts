import { describe, expect, it } from 'vitest'
import { matchingInvalidations, mergeInvalidations } from '../app/utils/query-invalidation'
import type { EntryKey, QueryInvalidation, QueryInvalidationRule } from '../app/utils/query-invalidation'
import type { DomainEvent } from '../shared/types/domain-events'

const event = (extra: Partial<DomainEvent> = {}): DomainEvent => ({
  domain: 'drive',
  service: 'proton',
  type: 'changed',
  at: '2026-11-26T10:00:00.000Z',
  ...extra
})

const rule: QueryInvalidationRule = {
  filter: { domains: ['drive'], services: ['proton'] },
  keys: event => event ? [['drive', event.service]] : [['drive']],
  predicate: () => true
}

describe('matchingInvalidations', () => {
  it.each([
    ['matching domain and service', event(), [['drive', 'proton']]],
    ['non-matching domain', event({ domain: 'mail' }), []],
    ['non-matching service', event({ service: 'gmail' }), []]
  ])('%s', (_label, domainEvent, expected) => {
    expect(matchingInvalidations(domainEvent, [rule]).map(invalidation => invalidation.key)).toEqual(expected)
  })

  it('uses the full prefix of every rule on reconnect', () => {
    expect(matchingInvalidations(undefined, [rule]).map(invalidation => invalidation.key)).toEqual([['drive']])
  })
})

describe('mergeInvalidations', () => {
  const prefix = ['mail', 'conversation'] as const
  const forOne = (key: EntryKey) => key[2] === 'one'
  const forTwo = (key: EntryKey) => key[2] === 'two'

  it.each([
    ['same key twice matches everything', [{ key: prefix }, { key: prefix }], [
      [['mail', 'conversation', 'three'], true]
    ]],
    ['two predicates are OR-ed', [{ key: prefix, predicate: forOne }, { key: prefix, predicate: forTwo }], [
      [['mail', 'conversation', 'one'], true],
      [['mail', 'conversation', 'two'], true],
      [['mail', 'conversation', 'three'], false]
    ]],
    ['a key without predicate covers a predicated one', [{ key: prefix, predicate: forOne }, { key: prefix }], [
      [['mail', 'conversation', 'two'], true]
    ]]
  ] satisfies [string, QueryInvalidation[], [EntryKey, boolean][]][])('%s', (_label, input, probes) => {
    const merged = mergeInvalidations(input)
    expect(merged).toHaveLength(1)
    for (const [key, expected] of probes) {
      expect(merged[0]!.predicate?.(key) ?? true).toBe(expected)
    }
  })
})
