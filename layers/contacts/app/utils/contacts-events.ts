import type { DomainEvent } from '#layers/core/shared/types/domain-events'

/** Whether an event asks the contacts page to reload its list. */
export function contactsRefreshFor(event: DomainEvent): boolean {
  return event.domain === 'contacts' && event.type === 'changed'
}
