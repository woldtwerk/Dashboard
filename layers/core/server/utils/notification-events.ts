import type { DomainEvent } from '../../shared/types/domain-events'

export interface SyncFailedNotification {
  category: 'sync-failed'
  title: string
  domain: string
  service: string
  dedupeKey: string
}

/** One notification per service and hour, whatever how often its sync retries. */
export function syncFailedNotification(event: DomainEvent, serviceName: string, now = new Date()): SyncFailedNotification {
  const hour = Math.floor(now.getTime() / 3_600_000)

  return {
    category: 'sync-failed',
    title: `${serviceName}: sync failed`,
    domain: event.domain,
    service: event.service,
    dedupeKey: `sync-failed:${event.service}:${hour}`
  }
}
