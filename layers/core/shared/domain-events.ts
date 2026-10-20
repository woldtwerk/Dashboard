import type { DomainEvent } from './types/domain-events'

/**
 * A domain event type: lower-case, starts with a letter, at most 32 characters.
 * `changed`, `synced` and `sync-failed` are the well-known values; every other
 * name belongs to the layer that publishes it.
 */
export const DOMAIN_EVENT_TYPE_RE = /^[a-z][a-z0-9-]{0,31}$/

export interface DomainEventFilter {
  domains?: string[]
  services?: string[]
}

/** Whether an event passes a subscription's domain/service filter; an empty list matches all. */
export function matchesFilter(event: DomainEvent, filter: DomainEventFilter): boolean {
  if (filter.domains?.length && !filter.domains.includes(event.domain)) {
    return false
  }
  if (filter.services?.length && !filter.services.includes(event.service)) {
    return false
  }
  return true
}
