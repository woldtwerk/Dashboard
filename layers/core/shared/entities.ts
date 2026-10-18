import type { EntityGraph, EntityRef, EntityType, GraphLink, GraphNode } from './types/entities'

const ENTITY_TYPES: EntityType[] = ['person', 'mail', 'event', 'contact', 'document', 'file']

/** Local part @ domain with at least one dot; matches what the mail providers accept */
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/**
 * Canonical form of an email: trimmed, lower-cased, display name and angle
 * brackets stripped. Returns undefined when nothing addressable is left.
 */
export function normalizeEmail(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  // `Jane Doe <jane@example.com>` keeps the address between the last pair of brackets
  const brackets = value.match(/<([^<>]*)>/g)
  const address = (brackets ? brackets[brackets.length - 1]!.slice(1, -1) : value).trim().toLowerCase()
  return EMAIL.test(address) ? address : undefined
}

function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as string[]).includes(value)
}

/** `type:service:id`, every part URI-encoded so ids may hold any character (person: `person::<email>`) */
export function entityKey(ref: EntityRef): string {
  return [ref.type, ref.service ?? '', ref.id].map(encodeURIComponent).join(':')
}

/** The ref an `entityKey` encodes, or undefined when the key is malformed */
export function parseEntityKey(key: string | null | undefined): EntityRef | undefined {
  if (!key) {
    return undefined
  }
  const parts = key.split(':')
  if (parts.length !== 3) {
    return undefined
  }
  const [type, service, id] = parts as [string, string, string]
  if (!isEntityType(type)) {
    return undefined
  }
  try {
    const decoded = decodeURIComponent(id)
    return decoded ? { type, service: service ? decodeURIComponent(service) : undefined, id: decoded } : undefined
  } catch {
    return undefined
  }
}

/** `?a=b&c=d` with the values URI-encoded, so a path or address survives the query string */
function query(params: [string, string][]): string {
  return `?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`
}

/** `<mailbox>/<uid>`; the mailbox may itself contain slashes, so only the last one separates */
function splitMailId(id: string): { mailbox: string, uid: string } {
  const at = id.lastIndexOf('/')
  return at < 0 ? { mailbox: '', uid: id } : { mailbox: id.slice(0, at), uid: id.slice(at + 1) }
}

/** `<calendarUrl>|<uid>|<recurrenceId?>`; the page addresses an event by uid and recurrence, not by URL */
function splitEventId(id: string): { uid: string, recurrenceId?: string } {
  const [calendar, uid, recurrenceId] = id.split('|')
  return { uid: uid ?? calendar ?? '', recurrenceId: recurrenceId ? recurrenceId : undefined }
}

/** The folder that holds `path`; a top-level entry sits in the root */
function parentOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at <= 0 ? '/' : path.slice(0, at)
}

/** The page that shows the item a ref points at */
export function entityLink(ref: EntityRef): string {
  switch (ref.type) {
    case 'mail': {
      const { mailbox, uid } = splitMailId(ref.id)
      return `/mail${query([['service', ref.service ?? ''], ['mailbox', mailbox], ['uid', uid]])}`
    }
    case 'event': {
      const { uid, recurrenceId } = splitEventId(ref.id)
      return `/calendar${query([['event', uid], ['recurrence', recurrenceId ?? '']])}`
    }
    case 'contact':
      return `/contacts${query([['contact', ref.id]])}`
    case 'document':
      return `/documents/${encodeURIComponent(ref.id)}`
    case 'file':
      return `/drive${query([['path', parentOf(ref.id)], ['item', ref.id]])}`
    case 'person':
      return `/people/${encodeURIComponent(ref.id)}`
  }
}

function linkKey(link: GraphLink): string {
  return [link.source, link.target, link.kind].join('\u0000')
}

/** Two graphs in one: nodes and links deduplicated, their frontiers united without the keys now loaded */
export function mergeGraphs(a: EntityGraph, b: EntityGraph): EntityGraph {
  const nodes = new Map<string, GraphNode>()
  for (const node of [...a.nodes, ...b.nodes]) {
    if (!nodes.has(node.key)) {
      nodes.set(node.key, node)
    }
  }

  const links = new Map<string, GraphLink>()
  for (const link of [...a.links, ...b.links]) {
    const key = linkKey(link)
    if (!links.has(key)) {
      links.set(key, link)
    }
  }

  const frontier = [...new Set([...a.frontier, ...b.frontier])].filter(key => !nodes.has(key))
  return { nodes: [...nodes.values()], links: [...links.values()], frontier }
}
