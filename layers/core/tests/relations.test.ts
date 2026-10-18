import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityRef, RelatedGroup, Relation } from '../shared/types/entities'
import {
  buildEntityGraph,
  GRAPH_RELATIONS_PER_NODE,
  groupRelations,
  invalidateRelationDomain,
  knownAddresses,
  registerRelationProvider,
  relatedTo,
  resetRelationProviders,
  sortRelations
} from '../server/utils/relations'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))

vi.mock('../server/utils/service-logger', () => ({
  useServiceLogger: () => ({ warn })
}))

const relation = (weight: number, at?: string, id = 'item'): Relation => ({
  kind: weight >= 1 ? 'to' : 'mentions',
  weight,
  item: {
    ref: { type: 'mail', service: 'svc', id },
    title: id,
    at,
    to: `/mail?uid=${id}`
  }
})

const person: EntityRef = { type: 'person', id: 'jane@example.com' }
const event: EntityRef = { type: 'event', service: 'svc', id: 'cal|uid-1' }

describe('sortRelations', () => {
  it('sorts by weight, then by time descending', () => {
    const { relations, truncated } = sortRelations([
      relation(0.5, '2026-10-18T10:00:00Z', 'strong-text'),
      relation(1, '2026-10-01T10:00:00Z', 'old'),
      relation(1, '2026-10-18T09:00:00Z', 'new')
    ], 10)

    expect(relations.map(item => item.item.title)).toEqual(['new', 'old', 'strong-text'])
    expect(truncated).toBe(false)
  })

  it('caps and marks the result as truncated', () => {
    const { relations, truncated } = sortRelations([relation(1, undefined, 'a'), relation(1, undefined, 'b')], 1)

    expect(relations).toHaveLength(1)
    expect(truncated).toBe(true)
  })

  it('treats a missing time as the oldest', () => {
    const { relations } = sortRelations([relation(1, undefined, 'undated'), relation(1, '2026-10-01T10:00:00Z', 'dated')], 10)

    expect(relations[0]!.item.title).toBe('dated')
  })
})

describe('groupRelations', () => {
  it('wraps the capped relations and keeps a custom label', () => {
    expect(groupRelations('mail', 'Mail', [relation(1, undefined, 'a')], 20)).toEqual({
      domain: 'mail',
      label: 'Mail',
      relations: [relation(1, undefined, 'a')],
      truncated: undefined
    })
  })

  it('omits a group that found nothing', () => {
    expect(groupRelations('mail', 'Mail', [], 20)).toBeUndefined()
  })
})

describe('buildEntityGraph', () => {
  const groups = (domain: string, relations: Relation[]): RelatedGroup[] => [{ domain, label: domain, relations }]

  it('loads the neighbours and leaves them on the frontier at depth 1', async () => {
    const calls: { ref: EntityRef, limit: number }[] = []
    const graph = await buildEntityGraph(person, 1, async (ref, limit) => {
      calls.push({ ref, limit })
      return groups('mail', [relation(1, '2026-10-01', 'INBOX/1')])
    })

    expect(calls).toEqual([{ ref: person, limit: GRAPH_RELATIONS_PER_NODE }])
    expect(graph.nodes.map(node => node.ref.type)).toEqual(['person', 'mail'])
    expect(graph.links).toEqual([{
      source: 'person::jane%40example.com',
      target: 'mail:svc:INBOX%2F1',
      kind: 'to',
      weight: 1
    }])
    expect(graph.frontier).toEqual(['mail:svc:INBOX%2F1'])
  })

  it('expands the neighbours at depth 2', async () => {
    const calls: string[] = []
    const graph = await buildEntityGraph(person, 2, async (ref) => {
      calls.push(ref.type)
      return ref.type === 'person' ? groups('mail', [relation(1, undefined, 'INBOX/1')]) : []
    })

    expect(calls).toEqual(['person', 'mail'])
    expect(graph.nodes).toHaveLength(2)
    expect(graph.frontier).toEqual([])
  })

  it('caps the nodes and puts the rest on the frontier', async () => {
    const graph = await buildEntityGraph(person, 1, async () => groups('mail', [
      relation(1, undefined, 'INBOX/1'),
      relation(1, undefined, 'INBOX/2')
    ]), { nodes: 2, relations: 25 })

    expect(graph.nodes.map(node => node.label)).toEqual(['jane@example.com', 'INBOX/1'])
    expect(graph.links).toHaveLength(1)
    expect(graph.frontier).toContain('mail:svc:INBOX%2F2')
  })

  it('adds nodes at the deepest level to the frontier', async () => {
    const graph = await buildEntityGraph(event, 1, async () => groups('calendar', [{
      ...relation(1, undefined, 'person'),
      item: { ref: person, title: 'Jane', to: '/people/jane' }
    }]))

    expect(graph.frontier).toEqual(['person::jane%40example.com'])
  })

  it('keeps going when one node cannot be loaded', async () => {
    const graph = await buildEntityGraph(person, 2, async (ref) => {
      if (ref.type === 'person') {
        return groups('mail', [relation(1, undefined, 'INBOX/1')])
      }
      throw new Error('unavailable')
    })

    expect(graph.nodes).toHaveLength(2)
    expect(graph.links).toHaveLength(1)
  })
})

describe('relatedTo', () => {
  let stored: Map<string, unknown>

  beforeEach(() => {
    stored = new Map()
    resetRelationProviders()
    warn.mockReset()

    const storage = {
      getMounts: () => [],
      getItem: async (key: string) => stored.get(key) ?? null,
      setItem: async (key: string, value: unknown) => {
        stored.set(key, value)
      },
      getKeys: async (base: string) => [...stored.keys()].filter(key => key.startsWith(base)),
      removeItem: async (key: string) => {
        stored.delete(key)
      }
    }
    vi.stubGlobal('useStorage', () => storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks every provider in parallel and caches each group for a minute', async () => {
    const mailRelated = vi.fn(async () => [relation(1, undefined, 'INBOX/1')])
    const calendarRelated = vi.fn(async () => [{
      ...relation(1, undefined, 'uid-1'),
      item: { ref: event, title: 'Standup', to: '/calendar?event=uid-1' }
    }])
    registerRelationProvider('mail', { label: 'Mail', related: mailRelated })
    registerRelationProvider('calendar', { label: 'Calendar', related: calendarRelated })

    expect((await relatedTo(person, 20)).map(group => group.domain)).toEqual(['mail', 'calendar'])
    expect((await relatedTo(person, 20)).map(group => group.domain)).toEqual(['mail', 'calendar'])

    expect(mailRelated).toHaveBeenCalledTimes(1)
    expect(calendarRelated).toHaveBeenCalledTimes(1)
    expect(stored.size).toBe(2)
  })

  it('only invalidates the domain whose event arrived', async () => {
    const mailRelated = vi.fn(async () => [relation(1, undefined, 'INBOX/1')])
    const calendarRelated = vi.fn(async () => [])
    registerRelationProvider('mail', { label: 'Mail', related: mailRelated })
    registerRelationProvider('calendar', { label: 'Calendar', related: calendarRelated })

    await relatedTo(person, 20)
    await invalidateRelationDomain('mail')
    await relatedTo(person, 20)

    expect(mailRelated).toHaveBeenCalledTimes(2)
    // The empty calendar answer stays cached; dropping mail must not drop it too
    expect(calendarRelated).toHaveBeenCalledTimes(1)
  })

  it('leaves out a provider that exceeds its timeout', async () => {
    registerRelationProvider('slow', { label: 'Slow', related: async () => new Promise<Relation[]>(() => {}) })
    registerRelationProvider('fast', { label: 'Fast', related: async () => [relation(1)] })

    const groups = await relatedTo(person, 20, 5)

    expect(groups.map(group => group.domain)).toEqual(['fast'])
    expect(warn).toHaveBeenCalledWith('Relations of "slow" are unavailable', expect.objectContaining({ error: expect.any(String) }))
  })

  it('skips empty groups', async () => {
    registerRelationProvider('empty', { label: 'Empty', related: async () => [] })

    expect(await relatedTo(person, 20)).toEqual([])
  })
})

describe('knownAddresses', () => {
  beforeEach(() => {
    resetRelationProviders()
    warn.mockReset()
  })

  it('unites every provider, normalized and deduplicated', async () => {
    registerRelationProvider('contacts', { label: 'Contacts', related: async () => [], addresses: async () => ['Alice@Example.com', 'bob@example.com'] })
    registerRelationProvider('calendar', { label: 'Calendar', related: async () => [], addresses: async () => ['ALICE@example.com'] })
    registerRelationProvider('mail', { label: 'Mail', related: async () => [] })

    expect(await knownAddresses()).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('leaves out a provider that exceeds its timeout', async () => {
    registerRelationProvider('contacts', { label: 'Contacts', related: async () => [], addresses: async () => new Promise<string[]>(() => {}) })
    registerRelationProvider('other', { label: 'Other', related: async () => [], addresses: async () => ['ok@example.com'] })

    expect(await knownAddresses(5)).toEqual(['ok@example.com'])
    expect(warn).toHaveBeenCalledWith('Addresses of "contacts" are unavailable', expect.objectContaining({ error: expect.any(String) }))
  })
})
