import type { DomainEvent } from './types/domain-events'

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
