import { describe, expect, it } from 'vitest'
import type { Relation } from '../../core/shared/types/entities'
import {
  correspondentEmail,
  correspondentMatches,
  dedupeRelations,
  extractEmails,
  quotedSearchTerms
} from '../server/utils/documents-relations'

describe('extractEmails', () => {
  it('finds normalized addresses in running text, without duplicates', () => {
    expect(extractEmails('Write to Jane.Doe@Example.com or jane.doe@example.com, not Bob@Example.org.'))
      .toEqual(['jane.doe@example.com', 'bob@example.org'])
  })

  it('caps the result', () => {
    const text = Array.from({ length: 15 }, (_, index) => `user${index}@example.com`).join(' ')
    expect(extractEmails(text)).toHaveLength(10)
    expect(extractEmails(text, 3)).toHaveLength(3)
  })

  it('is empty without text', () => {
    expect(extractEmails(undefined)).toEqual([])
    expect(extractEmails('no address here')).toEqual([])
  })
})

describe('correspondentEmail', () => {
  it('takes the address from the match rule', () => {
    expect(correspondentEmail({ name: 'Jane Doe', match: 'jane@example.com' })).toBe('jane@example.com')
  })

  it('skips wildcard match rules and falls back to the name', () => {
    expect(correspondentEmail({ name: 'billing@example.com', match: '*@example.com' })).toBe('billing@example.com')
  })

  it('is undefined when the correspondent has no address', () => {
    expect(correspondentEmail({ name: 'Jane Doe' })).toBeUndefined()
  })
})

describe('correspondentMatches', () => {
  it('matches the person name case-insensitively', () => {
    expect(correspondentMatches({ name: 'Jane Doe', match: '' }, 'jane@example.com', ' jane doe ')).toBe(true)
  })

  it('matches an address contained in the match rule', () => {
    expect(correspondentMatches({ name: 'Bank', match: 'statements@bank.example, jane@example.com' }, 'JANE@example.com')).toBe(true)
  })

  it('does not match an unrelated correspondent', () => {
    expect(correspondentMatches({ name: 'Bank', match: 'statements@bank.example' }, 'jane@example.com', 'Jane Doe')).toBe(false)
  })
})

describe('quotedSearchTerms', () => {
  it('quotes the address', () => {
    expect(quotedSearchTerms('jane@example.com')).toEqual(['"jane@example.com"'])
  })

  it('adds the full name only when it has at least two words', () => {
    expect(quotedSearchTerms('jane@example.com', 'Jane Doe')).toEqual(['"jane@example.com"', '"Jane Doe"'])
    expect(quotedSearchTerms('jane@example.com', 'Jane')).toEqual(['"jane@example.com"'])
  })
})

describe('dedupeRelations', () => {
  const relation = (id: string, weight: number): Relation => ({
    kind: weight >= 1 ? 'correspondent' : 'mentions',
    weight,
    item: { ref: { type: 'document', service: 'paper', id }, title: id, to: `/documents/${id}` }
  })

  it('keeps the stronger kind for the same document', () => {
    const relations = dedupeRelations([relation('1', 1), relation('1', 0.5), relation('2', 0.5)])

    expect(relations.map(item => [item.item.ref.id, item.kind])).toEqual([['1', 'correspondent'], ['2', 'mentions']])
  })
})
