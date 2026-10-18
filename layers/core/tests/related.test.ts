import { describe, expect, it } from 'vitest'
import type { EntityRef, Relation } from '../shared/types/entities'
import { relatedKey, splitRelations } from '../app/utils/related'

const relation = (kind: Relation['kind'], title: string): Relation => ({
  kind,
  weight: kind === 'mentions' ? 0.3 : 1,
  item: { ref: { type: 'mail', service: 'work', id: title }, title, to: `/mail?uid=${title}` }
})

describe('relatedKey', () => {
  it('keys a ref by its entity key', () => {
    expect(relatedKey({ type: 'mail', service: 'work', id: 'INBOX/42' })).toBe('entity-related:mail:work:INBOX%2F42')
    expect(relatedKey({ type: 'person', id: 'jane@example.com' })).toBe('entity-related:person::jane%40example.com')
  })

  it('differs for two different refs', () => {
    const a: EntityRef = { type: 'document', service: 'paper', id: '1' }
    const b: EntityRef = { type: 'document', service: 'paper', id: '2' }
    expect(relatedKey(a)).not.toBe(relatedKey(b))
  })
})

describe('splitRelations', () => {
  it('keeps structural relations and pulls mentions out', () => {
    const from = relation('from', 'from')
    const to = relation('to', 'to')
    const mentions = relation('mentions', 'mentions')

    expect(splitRelations([from, mentions, to])).toEqual({
      structural: [from, to],
      mentions: [mentions]
    })
  })

  it('is empty for an empty group', () => {
    expect(splitRelations([])).toEqual({ structural: [], mentions: [] })
  })
})
