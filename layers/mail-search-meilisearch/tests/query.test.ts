import { describe, expect, it } from 'vitest'
import { buildMailFilter, dayCountQueries, filterValue } from '../server/meilisearch/query'

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
      search: { unread: true, flagged: true, hasAttachment: true, since: '2026-10-01', before: '2026-10-16', from: ' @Stripe.com ', text: 'ignored here' }
    })).toEqual([
      'service IN ["a"]',
      'mailbox = "INBOX"',
      'unread = true',
      'flagged = true',
      'hasAttachment = true',
      'date >= 1790812800',
      'date < 1792108800',
      'fromTerms = "stripe.com"'
    ])
  })

  it('omits criteria that are not set', () => {
    expect(buildMailFilter({ services: ['a'], search: { hasAttachment: false, unread: false } })).toEqual(['service IN ["a"]'])
  })

  it('filters by a normalized participant', () => {
    expect(buildMailFilter({ services: ['a'], participant: ' Jane@Example.COM ', search: {} }))
      .toEqual(['service IN ["a"]', 'participantTerms = "jane@example.com"'])
  })

  it('filters by conversation keys and escapes them', () => {
    expect(buildMailFilter({ services: ['a'], conversationKeys: ['id:root@example.com', 'subj:a@b.com:hello "world"'], search: {} }))
      .toEqual(['service IN ["a"]', 'conversationKeys IN ["id:root@example.com", "subj:a@b.com:hello \\"world\\""]'])
  })

  it('omits empty conversation keys', () => {
    expect(buildMailFilter({ services: ['a'], conversationKeys: [], search: {} })).toEqual(['service IN ["a"]'])
  })

  it('restricts to an explicit list of mailboxes and escapes them', () => {
    expect(buildMailFilter({ services: ['a'], mailboxes: ['INBOX', 'Folders/"Work"'], search: {} }))
      .toEqual(['service IN ["a"]', 'mailbox IN ["INBOX", "Folders/\\"Work\\""]'])
  })

  it('omits an empty mailbox list', () => {
    expect(buildMailFilter({ services: ['a'], mailboxes: [], search: {} })).toEqual(['service IN ["a"]'])
  })
})

describe('dayCountQueries', () => {
  const unix = (date: string) => Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000)

  it('builds one count query per day, until exclusive', () => {
    const queries = dayCountQueries('2026-10-01', '2026-10-04', ['a', 'b'])

    expect(queries.map(query => query.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(queries[0]!.filter).toEqual([
      'service IN ["a", "b"]',
      `date >= ${unix('2026-10-01')}`,
      `date < ${unix('2026-10-02')}`
    ])
    expect(queries[2]!.filter).toEqual([
      'service IN ["a", "b"]',
      `date >= ${unix('2026-10-03')}`,
      `date < ${unix('2026-10-04')}`
    ])
  })

  it('returns no queries without a range or services', () => {
    expect(dayCountQueries('2026-10-04', '2026-10-01', ['a'])).toEqual([])
    expect(dayCountQueries('2026-10-01', '2026-10-01', ['a'])).toEqual([])
  })
})
