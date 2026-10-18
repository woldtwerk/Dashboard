import { entityKey, entityLink, mergeGraphs, normalizeEmail } from '../../shared/entities'
import type {
  EntityGraph,
  EntityRef,
  EntityType,
  GraphLink,
  GraphNode,
  Person,
  RelatedGroup,
  Relation
} from '../../shared/types/entities'
import { dashboardStorage, withTimeout } from './dashboard'
import { useServiceLogger } from './service-logger'

/** Everything a relation provider has to answer about one entity */
export interface RelationProvider {
  /** Heading of the provider's group, e.g. "Mail" */
  label: string
  related(ref: EntityRef, options: { limit: number }): Promise<Relation[]>
  /** What the providers know about an address; parts are merged by `resolvePerson` */
  person?(email: string): Promise<Partial<Person> | undefined>
  /**
   * Normalized addresses of the people the provider knows, e.g. a contacts
   * address book. Used to rank mail; the provider's answer is cached by its
   * caller, so this may read the whole directory.
   */
  addresses?(): Promise<string[]>
}

/** A provider that took longer than this is left out of the result */
export const RELATION_TIMEOUT_MS = 4_000
export const RELATION_TTL_SECONDS = 60

export const GRAPH_MAX_NODES = 150
export const GRAPH_RELATIONS_PER_NODE = 25

export interface GraphLimits {
  nodes: number
  relations: number
}

export const GRAPH_LIMITS: GraphLimits = { nodes: GRAPH_MAX_NODES, relations: GRAPH_RELATIONS_PER_NODE }

const providers = new Map<string, RelationProvider>()

/** Called by a domain layer's Nitro plugin; the core knows nothing domain-specific */
export function registerRelationProvider(domain: string, provider: RelationProvider) {
  providers.set(domain, provider)
}

/** Test hook; a server registers its providers once at startup */
export function resetRelationProviders() {
  providers.clear()
}

/** Relations of one entity, capped per provider; the strongest come first */
export function sortRelations(relations: Relation[], limit: number): { relations: Relation[], truncated: boolean } {
  const sorted = [...relations].sort((left, right) => right.weight - left.weight || timeOf(right.item.at) - timeOf(left.item.at))
  const capped = sorted.slice(0, Math.max(0, Math.trunc(limit)))

  return { relations: capped, truncated: sorted.length > capped.length }
}

function timeOf(at: string | undefined): number {
  return at ? new Date(at).getTime() || 0 : 0
}

/** One provider's answer as a group, or undefined when it found nothing */
export function groupRelations(domain: string, label: string, relations: Relation[], limit: number): RelatedGroup | undefined {
  const { relations: capped, truncated } = sortRelations(relations, limit)
  if (!capped.length) {
    return undefined
  }

  return { domain, label, relations: capped, truncated: truncated || undefined }
}

function cacheKey(domain: string, ref: EntityRef, limit: number): string {
  return `relations:${domain}:${entityKey(ref)}:${limit}`
}

async function readCachedGroup(key: string): Promise<RelatedGroup | undefined> {
  try {
    return await dashboardStorage().getItem<RelatedGroup>(key) ?? undefined
  } catch {
    // Relations still work without their cache
    return undefined
  }
}

async function writeCachedGroup(key: string, group: RelatedGroup): Promise<void> {
  try {
    await dashboardStorage().setItem(key, group, { ttl: RELATION_TTL_SECONDS })
  } catch {
    // Best effort: a cache write never makes a request fail
  }
}

/** Drops the cached relations a domain contributed. Called on its `changed` events. */
export async function invalidateRelationDomain(domain: string): Promise<void> {
  try {
    const storage = dashboardStorage()
    const keys = await storage.getKeys(`relations:${domain}:`)
    await Promise.all(keys.map(key => storage.removeItem(key)))
  } catch (error) {
    console.warn(`[relations] Could not invalidate the cache of "${domain}":`, error)
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Every domain's relations for one entity, strongest first per group. A provider
 * that fails or exceeds its timeout is left out, so one broken service never
 * hides the others.
 */
export async function relatedTo(ref: EntityRef, limit = 20, timeoutMs = RELATION_TIMEOUT_MS): Promise<RelatedGroup[]> {
  const results = await Promise.all([...providers].map(async ([domain, provider]): Promise<RelatedGroup | undefined> => {
    // Cached per domain, so one domain's `changed` event invalidates only its own answer
    const key = cacheKey(domain, ref, limit)
    const cached = await readCachedGroup(key)
    if (cached) {
      // An empty cached answer means "this domain has nothing", not "not cached"
      return cached.relations.length ? { ...cached, domain, label: provider.label } : undefined
    }

    try {
      const relations = await withTimeout(provider.related(ref, { limit }), timeoutMs)
      const group = groupRelations(domain, provider.label, relations, limit)
      await writeCachedGroup(key, group ?? { domain, label: provider.label, relations: [] })
      return group
    } catch (error) {
      useServiceLogger('core').warn(`Relations of "${domain}" are unavailable`, { error: errorText(error) })
      return undefined
    }
  }))

  return results.filter((group): group is RelatedGroup => !!group)
}

/**
 * What the providers know about an address. The name comes from the first
 * provider that has one, the emails are united, and the contact cards of all
 * providers are kept.
 */
export async function resolvePerson(email: string, timeoutMs = RELATION_TIMEOUT_MS): Promise<Person | undefined> {
  const key = normalizeEmail(email)
  if (!key) {
    return undefined
  }

  const entries = [...providers].filter(([, provider]) => !!provider.person)
  const parts = await Promise.all(entries.map(async ([domain, provider]): Promise<Partial<Person> | undefined> => {
    try {
      return await withTimeout(provider.person!(key), timeoutMs)
    } catch (error) {
      useServiceLogger('core').warn(`Person data of "${domain}" is unavailable`, { error: errorText(error) })
      return undefined
    }
  }))

  let name: string | undefined
  const emails = new Set<string>([key])
  const contacts = new Map<string, EntityRef>()
  let known = false

  for (const part of parts) {
    if (!part) {
      continue
    }

    if (!name && part.name?.trim()) {
      name = part.name.trim()
      known = true
    }
    for (const address of part.emails ?? []) {
      const normalized = normalizeEmail(address)
      if (normalized) {
        emails.add(normalized)
        known = true
      }
    }
    for (const contact of part.contacts ?? []) {
      contacts.set(entityKey(contact), contact)
      known = true
    }
  }

  return known ? { key, name, emails: [...emails], contacts: [...contacts.values()] } : undefined
}

/**
 * Every address the providers know as a person, normalized and deduplicated.
 * A provider that fails or exceeds its timeout contributes nothing, so one
 * broken directory never hides the others.
 */
export async function knownAddresses(timeoutMs = RELATION_TIMEOUT_MS): Promise<string[]> {
  const entries = [...providers].filter(([, provider]) => !!provider.addresses)
  const lists = await Promise.all(entries.map(async ([domain, provider]): Promise<string[]> => {
    try {
      return await withTimeout(provider.addresses!(), timeoutMs)
    } catch (error) {
      useServiceLogger('core').warn(`Addresses of "${domain}" are unavailable`, { error: errorText(error) })
      return []
    }
  }))

  const addresses = new Set<string>()
  for (const email of lists.flat()) {
    const normalized = normalizeEmail(email)
    if (normalized) {
      addresses.add(normalized)
    }
  }

  return [...addresses]
}

function rootDomain(type: EntityType): string {
  switch (type) {
    case 'person': return 'people'
    case 'mail': return 'mail'
    case 'event': return 'calendar'
    case 'contact': return 'contacts'
    case 'document': return 'documents'
    case 'file': return 'drive'
  }
}

function toNode(key: string, ref: EntityRef, label: string, domain: string, to: string): GraphNode {
  return { key, ref, label, domain, type: ref.type, to }
}

export type RelationLoader = (ref: EntityRef, limit: number) => Promise<RelatedGroup[]>

/**
 * Breadth-first graph around one entity. A node at the requested depth is not
 * expanded; it lands in `frontier` instead, as does a node that would exceed the
 * node budget. So every frontier key names something the caller can load next.
 */
export async function buildEntityGraph(
  ref: EntityRef,
  depth: number,
  load: RelationLoader,
  limits: GraphLimits = GRAPH_LIMITS
): Promise<EntityGraph> {
  const maxDepth = Math.min(2, Math.max(1, Math.trunc(depth)))
  const maxNodes = Math.max(1, Math.trunc(limits.nodes))
  const maxRelations = Math.max(1, Math.trunc(limits.relations))

  const rootKey = entityKey(ref)
  let graph: EntityGraph = {
    nodes: [toNode(rootKey, ref, ref.id, rootDomain(ref.type), entityLink(ref))],
    links: [],
    frontier: []
  }

  const levelOf = new Map<string, number>([[rootKey, 0]])
  const queue: EntityRef[] = [ref]
  const frontier = new Set<string>()

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    const key = entityKey(current)
    const level = levelOf.get(key) ?? 0

    if (level >= maxDepth) {
      frontier.add(key)
      continue
    }

    const groups = await load(current, maxRelations).catch(() => [])
    const nodes: GraphNode[] = []
    const links: GraphLink[] = []

    for (const group of groups) {
      for (const relation of group.relations) {
        const target = relation.item.ref
        const targetKey = entityKey(target)

        if (!levelOf.has(targetKey)) {
          if (levelOf.size >= maxNodes) {
            frontier.add(targetKey)
            continue
          }

          levelOf.set(targetKey, level + 1)
          nodes.push(toNode(targetKey, target, relation.item.title, group.domain, relation.item.to))
          queue.push(target)
        }

        links.push({ source: key, target: targetKey, kind: relation.kind, weight: relation.weight })
      }
    }

    graph = mergeGraphs(graph, { nodes, links, frontier: [] })
  }

  // Nodes at the deepest level have no loaded neighbours yet, so they stay on
  // the frontier even though their node itself is part of the graph.
  for (const [key, level] of levelOf) {
    if (level >= maxDepth) {
      frontier.add(key)
    }
  }

  return { nodes: graph.nodes, links: graph.links, frontier: [...frontier] }
}

/** Graph around one entity, at depth 1 or 2, using every registered provider */
export async function entityGraph(ref: EntityRef, depth: number): Promise<EntityGraph> {
  return await buildEntityGraph(ref, depth, (target, limit) => relatedTo(target, limit))
}
