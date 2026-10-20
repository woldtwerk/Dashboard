import { z } from 'zod'
import { DOMAIN_EVENT_TYPE_RE, matchesFilter } from '../../shared/domain-events'
import type { DomainEvent } from '../../shared/types/domain-events'

export type { DomainEventFilter } from '../../shared/domain-events'
export { matchesFilter }

/** Bus channels other than domain events, e.g. `logs`, live under one Redis prefix */
export const CHANNEL_PREFIX = 'allmight:'
export const DOMAIN_EVENTS_CHANNEL = 'domain-events'

export function channelName(channel: string): string {
  return `${CHANNEL_PREFIX}${channel}`
}

export interface DomainEventBus {
  publish(event: DomainEvent): Promise<void>
  /** Returns an unsubscribe function */
  subscribe(handler: (event: DomainEvent) => void): () => void
  /** Publishes an arbitrary payload on a separate channel, so it cannot crowd out events */
  publishTo(channel: string, payload: unknown): Promise<void>
  /** Returns an unsubscribe function */
  subscribeTo(channel: string, handler: (payload: unknown) => void): () => void
}

const eventSchema = z.object({
  domain: z.string().min(1),
  service: z.string().min(1),
  type: z.string().regex(DOMAIN_EVENT_TYPE_RE),
  resource: z.string().min(1).optional(),
  at: z.iso.datetime()
})

/** Parses one event value that already came through a bus; anything malformed is dropped. */
export function parseDomainEventValue(value: unknown): DomainEvent | undefined {
  const result = eventSchema.safeParse(value)
  return result.success ? result.data : undefined
}

/** Parses one Redis/SSE payload; anything malformed is dropped rather than delivered. */
export function parseDomainEvent(raw: string): DomainEvent | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }

  return parseDomainEventValue(value)
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
  const channels = new Map<string, Set<(payload: unknown) => void>>()

  function subscribeTo(channel: string, handler: (payload: unknown) => void): () => void {
    const handlers = channels.get(channel) ?? new Set()
    handlers.add(handler)
    channels.set(channel, handlers)

    return () => {
      handlers.delete(handler)
      if (!handlers.size) {
        channels.delete(channel)
      }
    }
  }

  function publishTo(channel: string, payload: unknown) {
    for (const handler of [...(channels.get(channel) ?? [])]) {
      try {
        handler(payload)
      } catch (error) {
        console.error(`[events] A "${channel}" subscriber failed:`, error)
      }
    }
  }

  return {
    async publish(event) {
      publishTo(DOMAIN_EVENTS_CHANNEL, event)
    },
    subscribe(handler) {
      return subscribeTo(DOMAIN_EVENTS_CHANNEL, (payload) => {
        const event = parseDomainEventValue(payload)
        if (event) {
          handler(event)
        }
      })
    },
    async publishTo(channel, payload) {
      publishTo(channel, payload)
    },
    subscribeTo
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

/** Same contract for channels such as `logs`: a busy or down broker never fails a write. */
export async function publishToChannel(channel: string, payload: unknown): Promise<void> {
  try {
    await useDomainEventBus().publishTo(channel, payload)
  } catch (error) {
    console.error(`[events] Could not publish to "${channel}":`, error)
  }
}
