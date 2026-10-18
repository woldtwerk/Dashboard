import { describe, expect, it } from 'vitest'
import type { EntityGraph, EntityType, GraphLink, GraphNode } from '../shared/types/entities'
import { entityTypeLabel, expandNode, graphData, graphLegend, linkStyle, nodeStyle } from '../app/utils/graph'

const node = (type: EntityType, patch: Partial<GraphNode> = {}): GraphNode => ({
  key: `${type}::1`,
  ref: { type, id: '1' },
  label: 'Node',
  domain: type === 'person' ? 'people' : type,
  type,
  to: '/',
  ...patch
})

describe('entityTypeLabel', () => {
  it('capitalizes the type', () => {
    expect(entityTypeLabel('person')).toBe('Person')
    expect(entityTypeLabel('document')).toBe('Document')
  })
})

describe('nodeStyle', () => {
  it('colors a node by its domain', () => {
    expect(nodeStyle(node('mail')).color).toBe('var(--chart-mail)')
    expect(nodeStyle(node('document', { domain: 'documents' })).color).toBe('var(--chart-documents)')
  })

  it('gives a person the core color, since people span domains', () => {
    expect(nodeStyle(node('person')).color).toBe('var(--chart-core)')
  })

  it('falls back to the core token for an unknown domain', () => {
    expect(nodeStyle(node('file', { domain: 'unknown' })).color).toBe('var(--chart-core)')
  })

  it('gives every type its own glyph and shape', () => {
    const person = nodeStyle(node('person'))
    const mail = nodeStyle(node('mail'))

    expect(person.shape).toBe('circle')
    expect(mail.shape).toBe('square')
    expect(person.glyph).not.toBe(mail.glyph)
    expect(person.icon).toBe('i-lucide-user')
  })
})

describe('linkStyle', () => {
  it('draws a mention dashed and thinner than a structural link', () => {
    const from = linkStyle({ kind: 'from', weight: 1 })
    const mentions = linkStyle({ kind: 'mentions', weight: 1 })

    expect(from.style).toBe('solid')
    expect(mentions.style).toBe('dashed')
    expect(mentions.width).toBeLessThan(from.width)
  })

  it('scales the width with the weight and clamps it', () => {
    expect(linkStyle({ kind: 'from', weight: 0.1 }).width).toBe(0.6)
    expect(linkStyle({ kind: 'from', weight: 10 }).width).toBe(3)
  })
})

describe('graphData', () => {
  const link = (patch: Partial<GraphLink> = {}): GraphLink => ({ source: 'mail::1', target: 'person::1', kind: 'to', weight: 1, ...patch })
  const graph: EntityGraph = {
    nodes: [node('mail'), node('person')],
    links: [link()],
    frontier: ['person::1']
  }

  it('maps nodes into the shape unovis draws', () => {
    const { nodes } = graphData(graph)
    const mail = nodes.find(item => item.key === 'mail::1')!

    expect(mail.id).toBe('mail::1')
    expect(mail.fill).toBe('var(--chart-mail)')
    expect(mail.frontier).toBe(false)
  })

  it('marks frontier nodes', () => {
    const { nodes } = graphData(graph)
    expect(nodes.find(item => item.key === 'person::1')!.frontier).toBe(true)
  })

  it('keys links and applies their style', () => {
    const { links } = graphData(graph)
    expect(links).toHaveLength(1)
    expect(links[0]!.id).toBe('mail::1\u0000person::1\u0000to')
    expect(links[0]!.style).toBe('solid')
  })
})

describe('graphLegend', () => {
  it('lists the types present, in a stable order', () => {
    const legend = graphLegend({
      nodes: [node('person'), node('mail'), node('person', { key: 'person::2' })],
      links: [],
      frontier: []
    })

    expect(legend.map(entry => entry.type)).toEqual(['person', 'mail'])
    expect(legend[0]).toEqual({ type: 'person', label: 'Person', icon: 'i-lucide-user' })
  })
})

describe('expandNode', () => {
  const base: EntityGraph = {
    nodes: [node('mail')],
    links: [],
    frontier: ['person::1']
  }
  const fetched: EntityGraph = {
    nodes: [node('person'), node('event')],
    links: [{ source: 'person::1', target: 'event::1', kind: 'attendee', weight: 1 }],
    frontier: []
  }

  it('merges the fetched neighbours and clears the expanded key', () => {
    const expanded = expandNode(base, 'person::1', fetched)

    expect(expanded.nodes.map(item => item.key)).toEqual(['mail::1', 'person::1', 'event::1'])
    expect(expanded.links).toHaveLength(1)
    expect(expanded.frontier).toEqual([])
  })
})
