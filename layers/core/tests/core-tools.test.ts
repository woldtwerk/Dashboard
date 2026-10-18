import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityRef, Relation } from '../shared/types/entities'

vi.mock('../server/utils/service-logger', () => ({
  useServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

const {
  listDomainTools,
  registerDomainTools,
  runDomainTool
} = await import('../server/utils/domain-tools')
const {
  registerRelationProvider,
  resetRelationProviders
} = await import('../server/utils/relations')
const { coreTools } = await import('../server/tools')

registerDomainTools(coreTools)

const context = { scope: 'read' as const, caller: 'test' }

const person: EntityRef = { type: 'person', id: 'jane@example.com' }

const mailRef = (uid: string): EntityRef => ({ type: 'mail', service: 'work', id: `INBOX/${uid}` })

function mailRelation(uid: string, at?: string, subtitle?: string): Relation {
  return {
    kind: 'from',
    weight: 1,
    item: {
      ref: mailRef(uid),
      title: `Subject ${uid}`,
      subtitle,
      at,
      to: `/mail?uid=${uid}`
    }
  }
}

function memoryStorage() {
  const stored = new Map<string, unknown>()

  return {
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
}

beforeEach(() => {
  vi.stubGlobal('useStorage', () => memoryStorage())
})

afterEach(() => {
  resetRelationProviders()
  vi.unstubAllGlobals()
})

describe('core tool registration', () => {
  it('exposes all four cross-reference tools to a read scope', () => {
    const names = listDomainTools({ scope: 'read', domains: ['core'] }).map(tool => tool.name).sort()

    expect(names).toEqual(['find_person', 'get_graph', 'get_related', 'list_known_people'])
    expect(coreTools.every(tool => !tool.writes)).toBe(true)
  })
})

describe('get_related', () => {
  it('returns the compact shape with only fields the group has', async () => {
    registerRelationProvider('mail', {
      label: 'Mail',
      related: async () => [
        mailRelation('1', '2026-10-18T09:00:00Z', 'Jane <jane@example.com>'),
        mailRelation('2')
      ]
    })

    const result = await runDomainTool('get_related', { ref: 'person::jane%40example.com' }, context) as {
      groups: { domain: string, label: string, items: unknown[], truncated: boolean }[]
    }

    expect(result).toEqual({
      groups: [{
        domain: 'mail',
        label: 'Mail',
        items: [
          {
            ref: 'mail:work:INBOX%2F1',
            type: 'mail',
            title: 'Subject 1',
            subtitle: 'Jane <jane@example.com>',
            date: '2026-10-18T09:00:00Z'
          },
          {
            ref: 'mail:work:INBOX%2F2',
            type: 'mail',
            title: 'Subject 2'
          }
        ],
        truncated: false
      }]
    })
    // No mail body or navigation link leaks into the tool result
    expect(JSON.stringify(result)).not.toContain('/mail?uid=')
  })

  it('marks a group whose limit cut it short as truncated', async () => {
    registerRelationProvider('mail', {
      label: 'Mail',
      related: async () => [mailRelation('1'), mailRelation('2')]
    })

    const result = await runDomainTool('get_related', { ref: 'person::jane%40example.com', limit: 1 }, context) as {
      groups: { items: unknown[], truncated: boolean }[]
    }

    expect(result.groups[0]).toMatchObject({ truncated: true })
    expect(result.groups[0]!.items).toHaveLength(1)
  })

  it('rejects a malformed ref with a 400 before asking any provider', async () => {
    const related = vi.fn(async () => [])
    registerRelationProvider('mail', { label: 'Mail', related })

    await expect(runDomainTool('get_related', { ref: 'not-a-key' }, context))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(runDomainTool('get_related', { ref: 'mail:work:' }, context))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(related).not.toHaveBeenCalled()
  })

  it('enforces the limit bounds', async () => {
    registerRelationProvider('mail', { label: 'Mail', related: async () => [] })

    await expect(runDomainTool('get_related', { ref: 'person::jane%40example.com', limit: 0 }, context))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(runDomainTool('get_related', { ref: 'person::jane%40example.com', limit: 51 }, context))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('defaults the limit to 20 per provider', async () => {
    const related = vi.fn(async () => [])
    registerRelationProvider('mail', { label: 'Mail', related })

    await runDomainTool('get_related', { ref: 'person::jane%40example.com' }, context)

    expect(related).toHaveBeenCalledWith(person, { limit: 20 })
  })
})

describe('find_person', () => {
  it('returns the resolved person and their related groups', async () => {
    registerRelationProvider('contacts', {
      label: 'Contacts',
      related: async () => [],
      person: async () => ({
        name: 'Jane Doe',
        emails: ['JANE@example.com', 'Jane@Work.Example.com'],
        contacts: [{ type: 'contact', service: 'work', id: 'card-1' }]
      })
    })
    registerRelationProvider('mail', {
      label: 'Mail',
      related: async () => [mailRelation('1', '2026-10-18T09:00:00Z')]
    })

    const result = await runDomainTool('find_person', { email: 'Jane@Example.com' }, context)

    expect(result).toEqual({
      person: {
        key: 'jane@example.com',
        name: 'Jane Doe',
        emails: ['jane@example.com', 'jane@work.example.com'],
        contacts: ['contact:work:card-1']
      },
      groups: [{
        domain: 'mail',
        label: 'Mail',
        items: [{ ref: 'mail:work:INBOX%2F1', type: 'mail', title: 'Subject 1', date: '2026-10-18T09:00:00Z' }],
        truncated: false
      }]
    })
  })

  it('answers an unknown address with an empty result', async () => {
    registerRelationProvider('contacts', {
      label: 'Contacts',
      related: async () => [],
      person: async () => undefined
    })

    await expect(runDomainTool('find_person', { email: 'nobody@example.com' }, context))
      .resolves.toEqual({ person: null, groups: [] })
  })

  it('rejects an address that is not an email', async () => {
    await expect(runDomainTool('find_person', { email: 'not-an-address' }, context))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('get_graph', () => {
  const graphProvider = () => {
    registerRelationProvider('mail', {
      label: 'Mail',
      related: async (ref: EntityRef) => ref.type === 'person' ? [mailRelation('1')] : []
    })
  }

  it('returns nodes, links and the truncated flag', async () => {
    graphProvider()

    const result = await runDomainTool('get_graph', { ref: 'person::jane%40example.com' }, context)

    expect(result).toEqual({
      nodes: [
        { key: 'person::jane%40example.com', type: 'person', title: 'jane@example.com' },
        { key: 'mail:work:INBOX%2F1', type: 'mail', title: 'Subject 1' }
      ],
      links: [{ source: 'person::jane%40example.com', target: 'mail:work:INBOX%2F1' }],
      truncated: true
    })
  })

  it('expands to depth 2 and reports a complete graph', async () => {
    graphProvider()

    const result = await runDomainTool('get_graph', { ref: 'person::jane%40example.com', depth: 2 }, context) as {
      nodes: unknown[]
      truncated: boolean
    }

    expect(result.nodes).toHaveLength(2)
    expect(result.truncated).toBe(false)
  })

  it('rejects a depth outside 1 or 2', async () => {
    await expect(runDomainTool('get_graph', { ref: 'person::jane%40example.com', depth: 3 }, context))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('list_known_people', () => {
  beforeEach(() => {
    registerRelationProvider('contacts', {
      label: 'Contacts',
      related: async () => [],
      addresses: async () => ['Alice@Example.com', 'bob@example.com', 'carol@example.org']
    })
  })

  it('filters case-insensitively and slices to the limit', async () => {
    await expect(runDomainTool('list_known_people', { query: 'ALICE' }, context))
      .resolves.toEqual({ people: ['alice@example.com'] })
    await expect(runDomainTool('list_known_people', { query: 'example', limit: 2 }, context))
      .resolves.toEqual({ people: ['alice@example.com', 'bob@example.com'] })
    await expect(runDomainTool('list_known_people', {}, context))
      .resolves.toEqual({ people: ['alice@example.com', 'bob@example.com', 'carol@example.org'] })
  })

  it('enforces the limit bounds', async () => {
    await expect(runDomainTool('list_known_people', { limit: 0 }, context))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(runDomainTool('list_known_people', { limit: 101 }, context))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})
