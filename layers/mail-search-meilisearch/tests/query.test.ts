import { describe, expect, it } from 'vitest'
import { buildMailFilter, filterValue } from '../server/meilisearch/query'

describe('filterValue', () => {
  it('quotes and escapes', () => {
    expect(filterValue('Folders/"Work"\\x')).toBe('"Folders/\\"Work\\"\\\\x"')
  })
})

describe('buildMailFilter', () => {
  it('always scopes to the services', () => {
    expect(buildMailFilter({ services: ['a', 'b'], search: {} })).toEqual(['service IN ["a", "b"]'])
  })

  it('maps every criterion', () => {
    expect(buildMailFilter({
      services: ['a'],
      mailbox: 'INBOX',
      search: { unread: true, flagged: true, since: '2026-10-01', before: '2026-10-16', from: ' @Stripe.com ', text: 'ignored here' }
    })).toEqual([
      'service IN ["a"]',
      'mailbox = "INBOX"',
      'unread = true',
      'flagged = true',
      'date >= 1790812800',
      'date < 1792108800',
      'fromTerms = "stripe.com"'
    ])
  })
})
