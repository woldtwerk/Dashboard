import type { DomainEvent } from '#layers/core/shared/types/domain-events'

/** Whether an event asks the calendar page to reload its events and calendars. */
export function calendarRefreshFor(event: DomainEvent): boolean {
  return event.domain === 'calendar' && (event.type === 'synced' || event.type === 'changed')
}
