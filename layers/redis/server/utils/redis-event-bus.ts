import Redis from 'ioredis'
import { parseDomainEvent } from '../../../core/server/utils/domain-events'
import type { DomainEventBus } from '../../../core/server/utils/domain-events'
import type { DomainEvent } from '../../../core/shared/types/domain-events'

/** Shared by every worker; subscribers fan the messages out to local SSE clients. */
export const DOMAIN_EVENT_CHANNEL = 'allmight:domain-events'

export interface RedisEventBus extends DomainEventBus {
  close(): Promise<void>
}

/**
 * One publisher and one subscriber connection per worker, both created on first
 * use. The subscriber holds the single Redis subscription for this worker; its
 * handlers live in a local Set.
 */
export function createRedisEventBus(url: string): RedisEventBus {
  let publisher: Redis | undefined
  let subscriber: Redis | undefined
  let subscribed = false
  const handlers = new Set<(event: DomainEvent) => void>()

  function connections() {
    if (!publisher) {
      publisher = new Redis(url)
    }

    if (!subscriber) {
      const connection = new Redis(url)
      connection.on('message', (channel, message) => {
        if (channel !== DOMAIN_EVENT_CHANNEL) {
          return
        }

        const event = parseDomainEvent(message)
        if (!event) {
          return
        }

        for (const handler of [...handlers]) {
          try {
            handler(event)
          } catch (error) {
            console.error('[events] A domain event subscriber failed:', error)
          }
        }
      })
      subscriber = connection
    }

    return { publisher, subscriber }
  }

  return {
    async publish(event) {
      const { publisher } = connections()
      await publisher.publish(DOMAIN_EVENT_CHANNEL, JSON.stringify(event))
    },
    subscribe(handler) {
      const { subscriber } = connections()
      handlers.add(handler)

      if (!subscribed) {
        subscribed = true
        subscriber.subscribe(DOMAIN_EVENT_CHANNEL).catch((error) => {
          subscribed = false
          console.error('[events] Could not subscribe to domain events:', error)
        })
      }

      return () => {
        handlers.delete(handler)
      }
    },
    async close() {
      handlers.clear()
      const open = [publisher, subscriber].filter((connection): connection is Redis => !!connection)
      publisher = undefined
      subscriber = undefined
      subscribed = false
      await Promise.allSettled(open.map(connection => connection.quit()))
    }
  }
}
