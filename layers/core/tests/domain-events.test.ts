import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInProcessBus,
  formatSseEvent,
  matchesFilter,
  parseDomainEvent,
  publishDomainEvent,
  registerDomainEventBus
} from '../server/utils/domain-events'
import type { DomainEvent } from '../shared/types/domain-events'

const event = (extra: Partial<DomainEvent> = {}): DomainEvent => ({
  domain: 'calendar',
  service: 'service-1',
  type: 'changed',
  at: '2026-10-18T10:00:00.000Z',
  ...extra
})

beforeEach(() => {
  registerDomainEventBus(() => createInProcessBus())
})

describe('in-process domain event bus', () => {
  it('delivers a published event to its subscribers', async () => {
    const bus = createInProcessBus()
    const received: DomainEvent[] = []
    bus.subscribe(item => received.push(item))

    await bus.publish(event())

    expect(received).toEqual([event()])
  })

  it('stops delivery after unsubscribe', async () => {
    const bus = createInProcessBus()
    const received: DomainEvent[] = []
    const unsubscribe = bus.subscribe(item => received.push(item))

    await bus.publish(event())
    unsubscribe()
    await bus.publish(event({ type: 'synced' }))

    expect(received).toHaveLength(1)
    expect(received[0]!.type).toBe('changed')
  })

  it('keeps another channel separate from domain events', async () => {
    const bus = createInProcessBus()
    const events: DomainEvent[] = []
    const logs: unknown[] = []
    bus.subscribe(item => events.push(item))
    bus.subscribeTo('logs', item => logs.push(item))

    await bus.publishTo('logs', { id: 1 })
    await bus.publish(event())

    expect(logs).toEqual([{ id: 1 }])
    expect(events).toHaveLength(1)
  })
})

describe('publishDomainEvent', () => {
  it('stamps the event with the current ISO timestamp', async () => {
    const publish = vi.fn<(item: DomainEvent) => Promise<void>>().mockResolvedValue()
    registerDomainEventBus(() => ({ publish, subscribe: () => () => {}, publishTo: async () => {}, subscribeTo: () => () => {} }))

    await publishDomainEvent({ domain: 'mail', service: 'account', type: 'synced' })

    const sent = publish.mock.calls[0]![0]
    expect(sent).toMatchObject({ domain: 'mail', service: 'account', type: 'synced' })
    expect(new Date(sent.at).toISOString()).toBe(sent.at)
  })

  it('swallows a failing bus, so a sync or write does not fail with it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerDomainEventBus(() => ({
      publish: async () => {
        throw new Error('redis is down')
      },
      subscribe: () => () => {},
      publishTo: async () => {},
      subscribeTo: () => () => {}
    }))

    await expect(publishDomainEvent({ domain: 'calendar', service: 'work', type: 'changed' })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('parseDomainEvent', () => {
  it('accepts a complete event', () => {
    expect(parseDomainEvent(JSON.stringify(event()))).toEqual(event())
  })

  it('accepts an event without a resource', () => {
    expect(parseDomainEvent(JSON.stringify(event({ type: 'sync-failed' })))).toEqual(event({ type: 'sync-failed' }))
  })

  it('drops malformed JSON', () => {
    expect(parseDomainEvent('{not json')).toBeUndefined()
  })

  it('drops an unknown type', () => {
    expect(parseDomainEvent(JSON.stringify({ ...event(), type: 'deleted' }))).toBeUndefined()
  })

  it('drops a missing timestamp', () => {
    const withoutTimestamp: Partial<DomainEvent> = { ...event() }
    delete withoutTimestamp.at
    expect(parseDomainEvent(JSON.stringify(withoutTimestamp))).toBeUndefined()
  })
})

describe('matchesFilter', () => {
  it('matches everything without filters', () => {
    expect(matchesFilter(event(), {})).toBe(true)
  })

  it('filters by domain and service', () => {
    expect(matchesFilter(event(), { domains: ['calendar'] })).toBe(true)
    expect(matchesFilter(event(), { domains: ['mail'] })).toBe(false)
    expect(matchesFilter(event(), { services: ['service-1'] })).toBe(true)
    expect(matchesFilter(event(), { services: ['service-2'] })).toBe(false)
  })

  it('requires every given filter to pass', () => {
    expect(matchesFilter(event(), { domains: ['calendar'], services: ['service-2'] })).toBe(false)
  })
})

describe('formatSseEvent', () => {
  it('wraps the event as a named SSE data line', () => {
    const item = event({ resource: 'https://cal.example/work' })

    expect(formatSseEvent(item)).toEqual({
      event: 'domain-event',
      data: JSON.stringify(item)
    })
  })
})
