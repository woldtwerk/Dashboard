import { z } from 'zod'
import { entityKey, entityLink, normalizeEmail, parseEntityKey } from '../shared/entities'
import type { EntityType, RelatedGroup } from '../shared/types/entities'
import type { DomainTool, ToolSource } from '../shared/types/tools'
import { entityGraph, knownAddresses, relatedTo, resolvePerson } from './utils/relations'

/** One related item as a tool client sees it: no bodies, no links, no icons. */
export interface CoreToolItem {
  /** Entity key of the item; pass it back as `ref` to walk further */
  ref: string
  type: EntityType
  title: string
  subtitle?: string
  /** ISO time the item is sorted by, e.g. mail date or event start */
  date?: string
}

export interface CoreToolGroup {
  domain: string
  label: string
  items: CoreToolItem[]
  truncated: boolean
}

/** The compact form of related groups that every core tool returns */
export function compactGroups(groups: RelatedGroup[]): CoreToolGroup[] {
  return groups.map(group => ({
    domain: group.domain,
    label: group.label,
    items: group.relations.map(relation => ({
      ref: entityKey(relation.item.ref),
      type: relation.item.ref.type,
      title: relation.item.title,
      ...(relation.item.subtitle ? { subtitle: relation.item.subtitle } : {}),
      ...(relation.item.at ? { date: relation.item.at } : {})
    })),
    truncated: !!group.truncated
  }))
}

const REF_EXAMPLES = [
  'person::jane%40example.com',
  'mail:work:INBOX%2F42',
  'event:work:https%3A%2F%2Fcal.example.com%2Fcal%2Fdefault%7Cuid-1%7C',
  'contact:work:card-1234',
  'document:paperless:42',
  'file:drive:%2FDocs%2Freport.pdf'
].join(', ')

const refDescription = [
  'Entity key `type:service:id`, URI-encoded, as returned in the `ref` field of related items and graph nodes.',
  'Person: `person::<email>` (no service). Mail: `mail:<service>:<mailbox>/<uid>`.',
  'Event: `event:<service>:<calendarUrl>|<uid>|<recurrenceId>`. Contact: `contact:<service>:<uid>`.',
  'Document: `document:<service>:<id>`. File: `file:<service>:<path>`.',
  `Examples: ${REF_EXAMPLES}`
].join(' ')

/** A node of the compact graph output, as `get_graph` returns it. */
export interface CoreToolNode {
  key: string
  type: EntityType
  title: string
}

/** The compact form of a person, as `find_person` returns it. */
export interface CoreToolPerson {
  key: string
  name?: string
  emails: string[]
  contacts: string[]
}

/**
 * A source row never shows more than this many graph nodes; the registry caps
 * every tool's cards, and the graph is the one output that routinely exceeds it.
 */
export const CORE_GRAPH_SOURCE_LIMIT = 20

/** One row per related item, named after the entity type it is; the domain it was found in is the fallback. */
export function relatedSources(output: unknown): ToolSource[] {
  const groups = (output as { groups?: CoreToolGroup[] } | undefined)?.groups
  if (!Array.isArray(groups)) {
    return []
  }

  return groups.flatMap(group => (group.items ?? []).map((item): ToolSource => {
    const ref = parseEntityKey(item.ref)

    return {
      kind: item.type || group.domain,
      title: item.title || item.ref,
      ...(item.subtitle ? { subtitle: item.subtitle } : {}),
      ...(item.date ? { date: item.date } : {}),
      ...(ref ? { link: entityLink(ref) } : {})
    }
  }))
}

/** The person first, then the items linked to them. */
export function personSources(output: unknown): ToolSource[] {
  const person = (output as { person?: CoreToolPerson | null } | undefined)?.person
  const rows: ToolSource[] = person
    ? [{
        kind: 'person',
        title: person.name || person.key,
        ...(person.name ? { subtitle: person.key } : {}),
        link: entityLink({ type: 'person', id: person.key })
      }]
    : []

  return [...rows, ...relatedSources(output)]
}

/** The graph nodes as rows, capped so a large graph does not flood the chat. */
export function graphSources(output: unknown): ToolSource[] {
  const nodes = (output as { nodes?: CoreToolNode[] } | undefined)?.nodes
  if (!Array.isArray(nodes)) {
    return []
  }

  return nodes.slice(0, CORE_GRAPH_SOURCE_LIMIT).map((node): ToolSource => {
    const ref = parseEntityKey(node.key)

    return {
      kind: node.type,
      title: node.title || node.key,
      ...(ref ? { link: entityLink(ref) } : {})
    }
  })
}

/** One row per known address; the service knows no display name for it. */
export function knownPeopleSources(output: unknown): ToolSource[] {
  const people = (output as { people?: string[] } | undefined)?.people
  if (!Array.isArray(people)) {
    return []
  }

  return people
    .filter(address => typeof address === 'string' && address.length > 0)
    .map(address => ({
      kind: 'person',
      title: address,
      link: entityLink({ type: 'person', id: address })
    }))
}

/** A ref that fails validation as a clear 400 before the tool runs */
const refInput = z.string().trim().min(1)
  .describe(refDescription)
  .transform((value, context) => {
    const ref = parseEntityKey(value)
    if (!ref) {
      context.addIssue({
        code: 'custom',
        message: `"${value}" is not an entity key; expected type:service:id, for example ${REF_EXAMPLES}`
      })
      return z.NEVER
    }
    return ref
  })

const limitInput = (max: number, fallback: number) => z.number().int().min(1).max(max).default(fallback)
  .describe(`Maximum number of items, at most ${max}`)

const relatedInput = z.object({
  ref: refInput,
  limit: limitInput(50, 20).describe('Maximum number of items per group, at most 50')
})

const personInput = z.object({
  email: z.email().describe('Email address of the person; matched case-insensitively after normalization')
})

const graphInput = z.object({
  ref: refInput,
  depth: z.union([z.literal(1), z.literal(2)]).default(1)
    .describe('How many relation hops to load: 1 for direct neighbours, 2 to expand them too')
})

const peopleInput = z.object({
  query: z.string().trim().max(200).optional()
    .describe('Case-insensitive fragment the address must contain; omit to list every known address'),
  limit: limitInput(100, 25).describe('Maximum number of addresses, at most 100')
})

export const coreTools: DomainTool[] = [
  {
    name: 'get_related',
    domain: 'core',
    description: 'List the mail, calendar events, contact cards, documents and drive files linked to one item. '
      + 'Groups come strongest first and each item carries the `ref` to walk further. Use it after mail_search, '
      + 'contacts_search or documents_search to see what else involves the sender, attendee or correspondent — '
      + 'for example to find the events and documents of the address that just sent a message. '
      + 'Read-only; returns metadata only, never mail bodies or document text.',
    input: relatedInput,
    writes: false,
    execute: async (raw) => {
      const input = raw as z.infer<typeof relatedInput>
      const groups = await relatedTo(input.ref, input.limit)

      return { groups: compactGroups(groups) }
    },
    sources: relatedSources
  },
  {
    name: 'find_person',
    domain: 'core',
    description: 'Look one person up by email address across every configured domain: their display name, all known '
      + 'addresses and contact cards, plus the mail, events, documents and files linked to them. '
      + 'Use it after mail_search to identify an unknown sender or before writing to someone to learn their other '
      + 'addresses and contact card. An address nobody knows returns `{ "person": null, "groups": [] }`.',
    input: personInput,
    writes: false,
    execute: async (raw) => {
      const input = raw as z.infer<typeof personInput>
      const email = normalizeEmail(input.email)
      if (!email) {
        return { person: null, groups: [] }
      }

      const [person, groups] = await Promise.all([
        resolvePerson(email),
        relatedTo({ type: 'person', id: email })
      ])

      return {
        person: person
          ? {
              key: person.key,
              name: person.name,
              emails: person.emails,
              contacts: person.contacts.map(entityKey)
            }
          : null,
        groups: compactGroups(groups)
      }
    },
    sources: personSources
  },
  {
    name: 'get_graph',
    domain: 'core',
    description: 'Return the cross-reference graph around one item as nodes and links. Depth 1 gives the direct '
      + 'neighbours, depth 2 also loads their neighbours. `truncated` is true when the node or relation budget cut '
      + 'the graph short; walk a node key with get_related to see past that. Use it to map a person\'s world or to '
      + 'connect two items that do not reference each other directly.',
    input: graphInput,
    writes: false,
    execute: async (raw) => {
      const input = raw as z.infer<typeof graphInput>
      const graph = await entityGraph(input.ref, input.depth)

      return {
        nodes: graph.nodes.map(node => ({ key: node.key, type: node.type, title: node.label })),
        links: graph.links.map(link => ({ source: link.source, target: link.target })),
        truncated: graph.frontier.length > 0
      }
    },
    sources: graphSources
  },
  {
    name: 'list_known_people',
    domain: 'core',
    description: 'List the email addresses the configured services know as people, normalized and deduplicated. '
      + 'Filter with `query` to find addresses by fragment before calling find_person. Use it to discover who the '
      + 'assistant may refer to, or to check whether an address is already known.',
    input: peopleInput,
    writes: false,
    execute: async (raw) => {
      const input = raw as z.infer<typeof peopleInput>
      const query = input.query?.toLowerCase()
      const people = (await knownAddresses())
        .filter(address => !query || address.includes(query))
        .slice(0, input.limit)

      return { people }
    },
    sources: knownPeopleSources
  }
]
