import Redis from 'ioredis'
import {
  CHANNEL_PREFIX,
  DOMAIN_EVENTS_CHANNEL,
  channelName,
  parseDomainEventValue
} from '../../../core/server/utils/domain-events'
import type { DomainEventBus } from '../../../core/server/utils/domain-events'

/** Shared by every worker; subscribers fan the messages out to local SSE clients. */
export const DOMAIN_EVENT_CHANNEL = channelName(DOMAIN_EVENTS_CHANNEL)

export interface RedisEventBus extends DomainEventBus {
  close(): Promise<void>
}

type PayloadHandler = (payload: unknown) => void

/**
 * One publisher and one subscriber connection per worker, both created on first
 * use. The subscriber holds one Redis subscription per channel in use; handlers
 * live in a local Map, so a worker only subscribes to what it serves.
 */
export function createRedisEventBus(url: string): RedisEventBus {
  let publisher: Redis | undefined
  let subscriber: Redis | undefined
  const handlers = new Map<string, Set<PayloadHandler>>()

  function publishConnection() {
    publisher ??= new Redis(url)
    return publisher
  }

  function connectionName(channel: string) {
    return channel.startsWith(CHANNEL_PREFIX) ? channel : channelName(channel)
  }

  function deliver(channel: string, payload: unknown) {
    for (const handler of [...(handlers.get(channel) ?? [])]) {
      try {
        handler(payload)
      } catch (error) {
        console.error(`[events] A "${channel}" subscriber failed:`, error)
      }
    }
  }

  function subscriberConnection() {
    if (!subscriber) {
      const connection = new Redis(url)
      connection.on('message', (channel, message) => {
        if (!channel.startsWith(CHANNEL_PREFIX)) {
          return
        }

        let payload: unknown
        try {
          payload = JSON.parse(message)
        } catch {
          return
        }

        deliver(channel.slice(CHANNEL_PREFIX.length), payload)
      })
      subscriber = connection
    }

    return subscriber
  }

  function subscribeTo(channel: string, handler: PayloadHandler): () => void {
    const channelHandlers = handlers.get(channel) ?? new Set()
    const isFirst = channelHandlers.size === 0
    channelHandlers.add(handler)
    handlers.set(channel, channelHandlers)

    if (isFirst) {
      subscriberConnection().subscribe(connectionName(channel)).catch((error) => {
        console.error(`[events] Could not subscribe to "${channel}":`, error)
      })
    }

    return () => {
      channelHandlers.delete(handler)
      if (channelHandlers.size) {
        return
      }

      handlers.delete(channel)
      subscriberConnection().unsubscribe(connectionName(channel)).catch((error) => {
        console.error(`[events] Could not unsubscribe from "${channel}":`, error)
      })
    }
  }

  async function publishTo(channel: string, payload: unknown) {
    await publishConnection().publish(connectionName(channel), JSON.stringify(payload))
  }

  return {
    async publish(event) {
      await publishTo(DOMAIN_EVENTS_CHANNEL, event)
    },
    subscribe(handler) {
      return subscribeTo(DOMAIN_EVENTS_CHANNEL, (payload) => {
        const event = parseDomainEventValue(payload)
        if (event) {
          handler(event)
        }
      })
    },
    publishTo,
    subscribeTo,
    async close() {
      handlers.clear()
      const open = [publisher, subscriber].filter((connection): connection is Redis => !!connection)
      publisher = undefined
      subscriber = undefined
      await Promise.allSettled(open.map(connection => connection.quit()))
    }
  }
}
