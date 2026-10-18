import { mergeGraphs } from '../../shared/entities'
import type { EntityGraph, EntityType, GraphLink, GraphNode, RelationKind } from '#layers/core/shared/types/entities'
import { domainColor } from './chart'

export type GraphNodeShapeName = 'circle' | 'square' | 'triangle' | 'hexagon'

export interface GraphNodeStyle {
  /** Fill color; a person belongs to no single domain and uses the core token */
  color: string
  /** Iconify name, e.g. for the legend */
  icon: string
  /** Glyph drawn inside the node by unovis */
  glyph: string
  shape: GraphNodeShapeName
}

const TYPE_STYLE: Record<EntityType, Omit<GraphNodeStyle, 'color'>> = {
  person: { icon: 'i-lucide-user', glyph: '☺', shape: 'circle' },
  mail: { icon: 'i-lucide-mail', glyph: '✉', shape: 'square' },
  event: { icon: 'i-lucide-calendar', glyph: '▦', shape: 'triangle' },
  contact: { icon: 'i-lucide-contact', glyph: '☎', shape: 'hexagon' },
  document: { icon: 'i-lucide-file-text', glyph: '▤', shape: 'square' },
  file: { icon: 'i-lucide-file', glyph: '▣', shape: 'hexagon' }
}

const TYPE_LABEL: Record<EntityType, string> = {
  person: 'Person',
  mail: 'Mail',
  event: 'Event',
  contact: 'Contact',
  document: 'Document',
  file: 'File'
}

/** Display name of an entity type, e.g. `mail` → `Mail`. */
export function entityTypeLabel(type: EntityType): string {
  return TYPE_LABEL[type]
}

/** Shape, glyph and fill of a node, fixed per type so the same type reads the same in every graph. */
export function nodeStyle(node: Pick<GraphNode, 'type' | 'domain'>): GraphNodeStyle {
  return {
    ...TYPE_STYLE[node.type],
    color: node.type === 'person' ? domainColor('core') : domainColor(node.domain)
  }
}

export interface GraphLinkStyle {
  style: 'solid' | 'dashed'
  width: number
}

/** A structural link is thicker than an inferred mention, which is dashed and thinner. */
export function linkStyle(link: Pick<GraphLink, 'kind' | 'weight'>): GraphLinkStyle {
  const mentions = link.kind === 'mentions'
  const base = mentions ? 0.5 : 1
  return { style: mentions ? 'dashed' : 'solid', width: Math.max(0.5, Math.min(3, base * link.weight + 0.5)) }
}

export interface GraphCanvasNode extends GraphNode {
  id: string
  fill: string
  shape: GraphNodeShapeName
  icon: string
  /** Neighbours of a frontier node were not loaded yet */
  frontier: boolean
}

export interface GraphCanvasLink extends GraphLink {
  id: string
  width: number
  style: 'solid' | 'dashed'
}

/** The graph in the shape unovis draws it, plus what the legend and the panel need. */
export function graphData(graph: EntityGraph): { nodes: GraphCanvasNode[], links: GraphCanvasLink[] } {
  const frontier = new Set(graph.frontier)
  return {
    nodes: graph.nodes.map((node) => {
      const style = nodeStyle(node)
      return { ...node, id: node.key, fill: style.color, shape: style.shape, icon: style.glyph, frontier: frontier.has(node.key) }
    }),
    links: graph.links.map(link => ({ ...link, id: linkId(link), ...linkStyle(link) }))
  }
}

function linkId(link: Pick<GraphLink, 'source' | 'target' | 'kind'>): string {
  return [link.source, link.target, link.kind].join('\u0000')
}

export interface GraphLegendEntry {
  type: EntityType
  label: string
  icon: string
}

/** One legend entry per type actually present in the graph, in a stable order. */
export function graphLegend(graph: EntityGraph): GraphLegendEntry[] {
  const present = new Set(graph.nodes.map(node => node.type))
  return (Object.keys(TYPE_STYLE) as EntityType[])
    .filter(type => present.has(type))
    .map(type => ({ type, label: entityTypeLabel(type), icon: TYPE_STYLE[type].icon }))
}

/** Label of a link kind, e.g. for a tooltip. */
export function linkLabel(kind: RelationKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** The graph with `fetched` (the neighbours of `key`) merged in, and `key` no longer a frontier node. */
export function expandNode(graph: EntityGraph, key: string, fetched: EntityGraph): EntityGraph {
  const merged = mergeGraphs(graph, fetched)
  return { ...merged, frontier: merged.frontier.filter(item => item !== key) }
}
