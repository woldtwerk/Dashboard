import { z } from 'zod'
import { matchesFilter } from '../../shared/domain-events'
import type { DomainEvent } from '../../shared/types/domain-events'

export type { DomainEventFilter } from '../../shared/domain-events'
export { matchesFilter }

export interface DomainEventBus {
  publish(event: DomainEvent): Promise<void>
  /** Returns an unsubscribe function */
  subscribe(handler: (event: DomainEvent) => void): () => void
}

const eventSchema = z.object({
  domain: z.string().min(1),
  service: z.string().min(1),
  type: z.enum(['changed', 'synced', 'sync-failed']),
  resource: z.string().min(1).optional(),
  at: z.iso.datetime()
})

/** Parses one Redis/SSE payload; anything malformed is dropped rather than delivered. */
export function parseDomainEvent(raw: string): DomainEvent | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }

  const result = eventSchema.safeParse(value)
  return result.success ? result.data : undefined
}

/** An SSE message carrying one domain event. */
export interface SseDomainEvent {
  event: 'domain-event'
  data: string
}

/** The wire form of an event; pure, so the endpoint and its test share one format. */
export function formatSseEvent(event: DomainEvent): SseDomainEvent {
  return { event: 'domain-event', data: JSON.stringify(event) }
}

/**
 * Single-process fallback. It cannot reach SSE connections held by another
 * cluster worker, so it is only correct while Nitro runs with one worker.
 */
export function createInProcessBus(): DomainEventBus {
  const handlers = new Set<(event: DomainEvent) => void>()

  return {
    async publish(event) {
      for (const handler of [...handlers]) {
        try {
          handler(event)
        } catch (error) {
          console.error('[events] A domain event subscriber failed:', error)
        }
      }
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    }
  }
}

let fallbackWarned = false

function fallbackBus(): DomainEventBus {
  if (!fallbackWarned) {
    fallbackWarned = true
    console.warn('[events] No domain event adapter registered; events stay inside this process. Set NUXT_REDIS_URL for delivery across cluster workers.')
  }
  return createInProcessBus()
}

let factory: (() => DomainEventBus) | undefined
let instance: DomainEventBus | undefined

/** Called by an adapter layer; without one, events only reach subscribers in this process. */
export function registerDomainEventBus(create: () => DomainEventBus) {
  factory = create
  instance = undefined
}

export function useDomainEventBus(): DomainEventBus {
  instance ??= factory?.() ?? fallbackBus()
  return instance
}

/**
 * Publishes a change to every worker and browser. A notification must never
 * fail the sync or write that caused it, so failures are logged and swallowed.
 */
export async function publishDomainEvent(event: Omit<DomainEvent, 'at'>): Promise<void> {
  try {
    await useDomainEventBus().publish({ ...event, at: new Date().toISOString() })
  } catch (error) {
    console.error('[events] Could not publish a domain event:', error)
  }
}
