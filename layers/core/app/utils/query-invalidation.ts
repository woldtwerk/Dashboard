import type { EntryKey } from '@pinia/colada'
import { matchesFilter } from '#layers/core/shared/domain-events'
import type { DomainEventFilter } from '#layers/core/shared/domain-events'
import type { DomainEvent } from '#layers/core/shared/types/domain-events'

/** The shape a query is cached under; layers type their event → key mapping with it. */
export type { EntryKey }

/** One cache invalidation: every entry whose key starts with `key`, unless `predicate` rejects it. */
export interface QueryInvalidation {
  key: EntryKey
  predicate?: (entryKey: EntryKey) => boolean
}

export interface QueryInvalidationRule {
  filter: DomainEventFilter
  /** Key prefixes an event invalidates; called without an event when events may have been missed. */
  keys: (event?: DomainEvent) => EntryKey[]
  /** Narrows an invalidation to the cache entries the event actually affects. */
  predicate?: (event: DomainEvent, entryKey: EntryKey) => boolean
}

const rules = new Set<QueryInvalidationRule>()

/** Registers what a domain's events invalidate; call from a layer's client plugin. */
export function defineQueryInvalidation(rule: QueryInvalidationRule): void {
  rules.add(rule)
}

/**
 * The invalidations an event triggers: every registered rule it matches, mapped
 * to its key prefixes. Called without an event (a reconnect), it returns the
 * full prefix of every rule, so queries whose events were missed still refresh.
 */
export function matchingInvalidations(
  event: DomainEvent | undefined,
  ruleList: Iterable<QueryInvalidationRule> = rules
): QueryInvalidation[] {
  const invalidations: QueryInvalidation[] = []
  for (const rule of ruleList) {
    if (event && !matchesFilter(event, rule.filter)) {
      continue
    }
    for (const key of rule.keys(event)) {
      invalidations.push({
        key,
        predicate: event && rule.predicate ? entryKey => rule.predicate!(event, entryKey) : undefined
      })
    }
  }
  return invalidations
}

/** A stable signature for a key prefix, so equal prefixes dedupe even when an object is in them. */
function keySignature(key: EntryKey): string {
  return JSON.stringify(key, (_, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
      : value)
}

/**
 * Coalesces the invalidations collected for one flush into one per key prefix.
 * Predicates of the same prefix are OR-ed; a prefix that also arrives without a
 * predicate drops them, because it already covers every entry.
 */
export function mergeInvalidations(invalidations: Iterable<QueryInvalidation>): QueryInvalidation[] {
  const merged = new Map<string, QueryInvalidation>()
  for (const invalidation of invalidations) {
    const signature = keySignature(invalidation.key)
    const current = merged.get(signature)
    if (!current) {
      merged.set(signature, invalidation)
      continue
    }
    if (!invalidation.predicate) {
      merged.set(signature, { key: current.key })
      continue
    }
    if (!current.predicate) {
      continue
    }
    const previous = current.predicate
    merged.set(signature, {
      key: current.key,
      predicate: entryKey => previous(entryKey) || invalidation.predicate!(entryKey)
    })
  }
  return [...merged.values()]
}
