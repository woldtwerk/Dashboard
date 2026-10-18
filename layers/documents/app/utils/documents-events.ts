import type { DomainEvent } from '#layers/core/shared/types/domain-events'

/** Whether an event asks the documents page to reload its list. */
export function documentsRefreshFor(event: DomainEvent): boolean {
  return event.domain === 'documents' && event.type === 'changed'
}
