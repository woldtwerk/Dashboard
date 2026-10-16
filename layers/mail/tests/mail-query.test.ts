import { describe, expect, it } from 'vitest'
import { mailSearchFromQuery, mailSearchToApiQuery, mailSearchToQuery } from '../app/utils/mail-query'

const today = new Date('2026-10-16T12:00:00Z')

describe('mailSearchFromQuery', () => {
  it('reads all criteria', () => {
    expect(mailSearchFromQuery({ q: 'invoice', unread: 'true', flagged: 'true', from: 'stripe', since: '2026-10-01', before: '2026-10-10' }, today)).toEqual({
      text: 'invoice', unread: true, flagged: true, from: 'stripe', since: '2026-10-01', before: '2026-10-10'
    })
  })

  it('turns a relative period into a date, an absolute date wins', () => {
    expect(mailSearchFromQuery({ days: '7' }, today).since).toBe('2026-10-09')
    expect(mailSearchFromQuery({ days: '7', since: '2026-01-01' }, today).since).toBe('2026-01-01')
  })

  it('ignores empty and invalid values', () => {
    expect(mailSearchFromQuery({ q: '', unread: 'yes', since: 'last week', from: ['a', 'b'] }, today)).toEqual({
      text: undefined, unread: undefined, flagged: undefined, from: undefined, since: undefined, before: undefined
    })
  })
})

describe('mailSearchToQuery', () => {
  it('replaces every criterion and drops the relative period', () => {
    expect(mailSearchToQuery({ text: ' tickets ', from: 'bahn', since: '2026-09-01' })).toEqual({
      q: 'tickets', unread: null, flagged: null, from: 'bahn', since: '2026-09-01', before: null, days: null
    })
  })

  it('round-trips through the URL', () => {
    const search = { text: 'agenda', unread: true, flagged: undefined, from: 'bob', since: '2026-10-01', before: undefined }
    const query = Object.fromEntries(Object.entries(mailSearchToQuery(search)).filter(([, value]) => value))

    expect(mailSearchFromQuery(query, today)).toEqual(search)
  })
})

describe('mailSearchToApiQuery', () => {
  it('only sends set criteria', () => {
    expect(mailSearchToApiQuery({ unread: true, flagged: false })).toEqual({
      q: undefined, unread: 'true', flagged: undefined, from: undefined, since: undefined, before: undefined
    })
  })
})
