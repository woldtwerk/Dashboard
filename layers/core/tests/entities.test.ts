import { describe, expect, it } from 'vitest'
import { entityKey, entityLink, mergeGraphs, normalizeEmail, parseEntityKey } from '../shared/entities'
import type { EntityGraph, EntityRef } from '../shared/types/entities'

describe('normalizeEmail', () => {
  it('trims and lower-cases a bare address', () => {
    expect(normalizeEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com')
  })

  it('strips the display name and angle brackets', () => {
    expect(normalizeEmail('Jane Doe <Jane@Example.com>')).toBe('jane@example.com')
    expect(normalizeEmail('<jane@example.com>')).toBe('jane@example.com')
    expect(normalizeEmail('"Doe, Jane" <jane@example.com>')).toBe('jane@example.com')
  })

  it('keeps characters that are legal in an address', () => {
    expect(normalizeEmail('jane+mail@sub.example.com')).toBe('jane+mail@sub.example.com')
  })

  it('is undefined for anything that is not an address', () => {
    expect(normalizeEmail('Jane Doe')).toBeUndefined()
    expect(normalizeEmail('jane@localhost')).toBeUndefined()
    expect(normalizeEmail('jane@@example.com')).toBeUndefined()
    expect(normalizeEmail('')).toBeUndefined()
    expect(normalizeEmail(undefined)).toBeUndefined()
  })
})

describe('entityKey', () => {
  it('joins type, service and id, URI-encoding every part', () => {
    expect(entityKey({ type: 'mail', service: 'work', id: 'INBOX/42' })).toBe('mail:work:INBOX%2F42')
    expect(entityKey({ type: 'file', service: 'drive', id: '/Docs/a|b' })).toBe('file:drive:%2FDocs%2Fa%7Cb')
  })

  it('leaves the service empty for a person', () => {
    expect(entityKey({ type: 'person', id: 'jane@example.com' })).toBe('person::jane%40example.com')
  })

  it('encodes the delimiters, so every id survives', () => {
    expect(entityKey({ type: 'mail', service: 'work', id: 'a:b/c|d' })).toBe('mail:work:a%3Ab%2Fc%7Cd')
  })
})

describe('parseEntityKey', () => {
  const refs: EntityRef[] = [
    { type: 'person', id: 'jane@example.com' },
    { type: 'mail', service: 'work', id: 'INBOX/42' },
    { type: 'mail', service: 'work', id: 'Folders/Work:2024/7' },
    { type: 'event', service: 'work', id: 'https://cal.example/cal/one|uid-1|2026-01-01T10:00:00Z' },
    { type: 'contact', service: 'work', id: 'card:1234' },
    { type: 'document', service: 'paper', id: '42' },
    { type: 'file', service: 'drive', id: '/my-files/Docs/a|b:c.pdf' }
  ]

  it('round-trips every ref through its key', () => {
    for (const ref of refs) {
      expect(parseEntityKey(entityKey(ref))).toEqual(ref)
    }
  })

  it('rejects malformed keys', () => {
    expect(parseEntityKey('person')).toBeUndefined()
    expect(parseEntityKey('person:jane@example.com')).toBeUndefined()
    expect(parseEntityKey('person::a:b')).toBeUndefined()
    expect(parseEntityKey('unknown::jane@example.com')).toBeUndefined()
    expect(parseEntityKey('person::')).toBeUndefined()
    expect(parseEntityKey('person::%ZZ')).toBeUndefined()
    expect(parseEntityKey('')).toBeUndefined()
    expect(parseEntityKey(undefined)).toBeUndefined()
  })
})

describe('entityLink', () => {
  it('opens a mail in its mailbox', () => {
    expect(entityLink({ type: 'mail', service: 'work', id: 'INBOX/42' }))
      .toBe('/mail?service=work&mailbox=INBOX&uid=42')
    expect(entityLink({ type: 'mail', service: 'work', id: 'Folders/Work/7' }))
      .toBe('/mail?service=work&mailbox=Folders%2FWork&uid=7')
    expect(entityLink({ type: 'mail', id: 'INBOX/42' }))
      .toBe('/mail?service=&mailbox=INBOX&uid=42')
  })

  it('opens an event, addressing its occurrence', () => {
    expect(entityLink({ type: 'event', service: 'work', id: 'https://cal.example/cal/one|uid-1|2026-01-01T10:00:00Z' }))
      .toBe('/calendar?event=uid-1&recurrence=2026-01-01T10%3A00%3A00Z')
    expect(entityLink({ type: 'event', service: 'work', id: 'https://cal.example/cal/one|uid-1' }))
      .toBe('/calendar?event=uid-1&recurrence=')
  })

  it('opens a contact card', () => {
    expect(entityLink({ type: 'contact', service: 'work', id: 'card-123' }))
      .toBe('/contacts?contact=card-123')
  })

  it('opens a document by id', () => {
    expect(entityLink({ type: 'document', service: 'paper', id: '42' })).toBe('/documents/42')
    expect(entityLink({ type: 'document', service: 'paper', id: 'a/b' })).toBe('/documents/a%2Fb')
  })

  it('opens the folder that holds a drive file and selects it', () => {
    expect(entityLink({ type: 'file', service: 'drive', id: '/my-files/Docs/report.pdf' }))
      .toBe('/drive?path=%2Fmy-files%2FDocs&item=%2Fmy-files%2FDocs%2Freport.pdf')
    expect(entityLink({ type: 'file', service: 'drive', id: '/top.pdf' }))
      .toBe('/drive?path=%2F&item=%2Ftop.pdf')
  })

  it('opens a person by email', () => {
    expect(entityLink({ type: 'person', id: 'jane@example.com' })).toBe('/people/jane%40example.com')
  })
})

describe('mergeGraphs', () => {
  const graph = (extra: Partial<EntityGraph>): EntityGraph => ({ nodes: [], links: [], frontier: [], ...extra })

  const person = { key: 'person::a', ref: { type: 'person', id: 'a' } as EntityRef, label: 'A', domain: 'people', type: 'person' as const, to: '/people/a' }
  const mail = { key: 'mail::1', ref: { type: 'mail', service: 'work', id: 'INBOX/1' } as EntityRef, label: 'Hi', domain: 'mail', type: 'mail' as const, to: '/mail?uid=1' }
  const event = { key: 'event::2', ref: { type: 'event', service: 'work', id: 'work|e|' } as EntityRef, label: 'Standup', domain: 'calendar', type: 'event' as const, to: '/calendar?event=e' }

  it('deduplicates nodes by key and keeps the first seen', () => {
    const merged = mergeGraphs(
      graph({ nodes: [person, mail] }),
      graph({ nodes: [{ ...mail, label: 'Other' }, event] })
    )

    expect(merged.nodes.map(node => node.key)).toEqual(['person::a', 'mail::1', 'event::2'])
    expect(merged.nodes[1]!.label).toBe('Hi')
  })

  it('deduplicates links by source, target and kind', () => {
    const merged = mergeGraphs(
      graph({ links: [{ source: 'person::a', target: 'mail::1', kind: 'to', weight: 1 }] }),
      graph({
        links: [
          { source: 'person::a', target: 'mail::1', kind: 'to', weight: 0.5 },
          { source: 'person::a', target: 'mail::1', kind: 'mentions', weight: 0.3 }
        ]
      })
    )

    expect(merged.links).toHaveLength(2)
    expect(merged.links[0]!.weight).toBe(1)
  })

  it('unites the frontiers and drops the keys that are now loaded', () => {
    const merged = mergeGraphs(
      graph({ nodes: [person], frontier: ['mail::1', 'event::2'] }),
      graph({ nodes: [mail], frontier: ['event::2'] })
    )

    expect(merged.frontier).toEqual(['event::2'])
  })

  it('keeps a frontier key that no node loaded', () => {
    const merged = mergeGraphs(graph({ frontier: ['person::a'] }), graph({ frontier: ['mail::1'] }))
    expect(merged.frontier).toEqual(['person::a', 'mail::1'])
  })
})
