import { describe, expect, it } from 'vitest'
import { matchingInvalidations } from '../app/utils/query-invalidation'
import type { QueryInvalidationRule } from '../app/utils/query-invalidation'
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
