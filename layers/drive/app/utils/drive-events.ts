import type { DomainEvent } from '#layers/core/shared/types/domain-events'

/** Whether an event changed the listing of the folder currently shown. */
export function driveRefreshFor(event: DomainEvent, path: string): boolean {
  return event.domain === 'drive'
    && event.type === 'changed'
    && (!event.resource || event.resource === path)
}
