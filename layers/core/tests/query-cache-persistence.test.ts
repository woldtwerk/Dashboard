import { describe, expect, it } from 'vitest'
import type { EntryKey } from '@pinia/colada'
import type { PersistedQueryCache } from '@pinia/colada-plugin-cache-persister'
import {
  isPersistedQueryFresh,
  mergeRestoredQueryCache,
  persistedQueryCacheKey,
  shouldPersistQuery
} from '../app/utils/query-cache-persistence'

const minute = 60_000
const hour = 60 * minute
const now = 2 * 24 * hour

describe('persistedQueryCacheKey', () => {
  it.each([
    [1, 'user-1', 'query-cache:v1:user-1'],
    [2, 'user-1', 'query-cache:v2:user-1']
  ])('version %i reads only its own key', (version, userId, expected) => {
    expect(persistedQueryCacheKey(userId, version)).toBe(expected)
  })
})

describe('shouldPersistQuery', () => {
  it.each([
    ['mail list', ['mail', 'proton', 'list'], 'success', true],
    ['mail message', ['mail', 'proton', 'message', 'INBOX', 1], 'success', true],
    ['drive listing', ['drive', 'proton', '/'], 'success', true],
    ['another domain', ['calendar', 'proton', 'events'], 'success', false],
    ['failed mail query', ['mail', 'proton', 'list'], 'error', false],
    ['pending mail query', ['mail', 'proton', 'list'], 'pending', false]
  ] satisfies [string, EntryKey, string, boolean][])('%s', (_label, key, status, expected) => {
    expect(shouldPersistQuery(key, status)).toBe(expected)
  })
})

const ttlCases = [
  ['mail message older than 30 minutes', ['mail', 'proton', 'message', 'INBOX', 1], 31 * minute, false],
  ['mail message within 30 minutes', ['mail', 'proton', 'message', 'INBOX', 1], 29 * minute, true],
  ['mail list older than a day', ['mail', 'proton', 'list'], 25 * hour, false],
  ['mail list within a day', ['mail', 'proton', 'list'], 23 * hour, true],
  ['drive listing older than a day', ['drive', 'proton', '/'], 25 * hour, false]
] satisfies [string, EntryKey, number, boolean][]

describe('mergeRestoredQueryCache', () => {
  const hash = JSON.stringify(['mail', 'proton', 'list'])
  const stored = (when: number): PersistedQueryCache[string] => ['last visit', null, when]

  it.each([
    ['hydrated newer wins', 2000, 1000, false],
    ['hydrated older loses', 500, 1000, true],
    ['missing is restored', undefined, 1000, true],
    ['equal keeps hydrated', 1000, 1000, false],
    ['an in-flight entry is not replaced', Number.POSITIVE_INFINITY, 1000, false]
  ] satisfies [string, number | undefined, number, boolean][])('%s', (_label, existingWhen, storedWhen, expected) => {
    const merged = mergeRestoredQueryCache({ [hash]: stored(storedWhen) }, () => existingWhen, 10_000)
    expect(merged[hash] !== undefined).toBe(expected)
  })

  it.each(ttlCases)('%s', (_label, key, age, expected) => {
    const hash = JSON.stringify(key)
    const cache: PersistedQueryCache = { [hash]: stored(now - age) }

    expect(mergeRestoredQueryCache(cache, () => undefined, now)[hash] !== undefined).toBe(expected)
  })

  it('keeps unrelated stored entries', () => {
    const otherHash = JSON.stringify(['drive', 'proton', '/'])
    const other: PersistedQueryCache[string] = ['drive listing', null, now - minute]
    const cache: PersistedQueryCache = { [hash]: stored(now - minute), [otherHash]: other }

    expect(mergeRestoredQueryCache(cache, keyHash => keyHash === hash ? Number.POSITIVE_INFINITY : undefined, now)).toEqual({ [otherHash]: other })
  })
})

describe('isPersistedQueryFresh', () => {
  it.each(ttlCases)('%s', (_label, key, age, expected) => {
    expect(isPersistedQueryFresh(key, now - age, now)).toBe(expected)
  })
})
