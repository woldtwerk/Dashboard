import { describe, expect, it } from 'vitest'
import type { MailSummary } from '../shared/types/mail'
import { isSelectedMail, mailListFromQuery, mailListToQuery, mailSearchFromQuery, mailSearchToApiQuery, mailSearchToQuery, mailSelectionFromQuery, mailSelectionToQuery } from '../app/utils/mail-query'

const today = new Date('2026-10-16T12:00:00Z')

const mail = (uid: number, mailbox: string): MailSummary => ({
  uid,
  mailbox,
  subject: 'x',
  from: [],
  date: '2026-10-16T10:00:00Z',
  unread: false,
  flagged: false
})

describe('mailSearchFromQuery', () => {
  it('reads all criteria', () => {
    expect(mailSearchFromQuery({ q: 'invoice', unread: 'true', flagged: 'true', from: 'stripe', attachment: 'true', since: '2026-10-01', before: '2026-10-10' }, today)).toEqual({
      text: 'invoice', unread: true, flagged: true, from: 'stripe', hasAttachment: true, since: '2026-10-01', before: '2026-10-10'
    })
  })

  it('turns a relative period into a date, an absolute date wins', () => {
    expect(mailSearchFromQuery({ days: '7' }, today).since).toBe('2026-10-09')
    expect(mailSearchFromQuery({ days: '7', since: '2026-01-01' }, today).since).toBe('2026-01-01')
  })

  it('ignores empty and invalid values', () => {
    expect(mailSearchFromQuery({ q: '', unread: 'yes', since: 'last week', from: ['a', 'b'] }, today)).toEqual({
      text: undefined, unread: undefined, flagged: undefined, from: undefined, hasAttachment: undefined, since: undefined, before: undefined
    })
  })
})

describe('mailSearchToQuery', () => {
  it('replaces every criterion and drops the relative period', () => {
    expect(mailSearchToQuery({ text: ' tickets ', from: 'bahn', hasAttachment: true, since: '2026-09-01' })).toEqual({
      q: 'tickets', unread: null, flagged: null, from: 'bahn', attachment: 'true', since: '2026-09-01', before: null, days: null
    })
  })

  it('round-trips through the URL', () => {
    const search = { text: 'agenda', unread: true, flagged: undefined, from: 'bob', hasAttachment: true, since: '2026-10-01', before: undefined }
    const query = Object.fromEntries(Object.entries(mailSearchToQuery(search)).filter(([, value]) => value))

    expect(mailSearchFromQuery(query, today)).toEqual(search)
  })
})

describe('mailSearchToApiQuery', () => {
  it('only sends set criteria', () => {
    expect(mailSearchToApiQuery({ unread: true, flagged: false, hasAttachment: true })).toEqual({
      q: undefined, unread: 'true', flagged: undefined, from: undefined, hasAttachment: 'true', since: undefined, before: undefined
    })
  })
})

describe('mailListFromQuery', () => {
  it('reads the scope and the number of loaded pages', () => {
    expect(mailListFromQuery({ scope: 'all', pages: '3' })).toEqual({ allFolders: true, pages: 3 })
    expect(mailListFromQuery({ scope: 'folder' })).toEqual({ allFolders: false, pages: 1 })
    expect(mailListFromQuery({ pages: '0' })).toEqual({ allFolders: false, pages: 1 })
    expect(mailListFromQuery({ pages: '-2' })).toEqual({ allFolders: false, pages: 1 })
  })

  it('round-trips through the URL', () => {
    const query = Object.fromEntries(Object.entries(mailListToQuery({ allFolders: true, pages: 2 })).filter(([, value]) => value))

    expect(mailListFromQuery(query)).toEqual({ allFolders: true, pages: 2 })
    expect(mailListToQuery({ allFolders: false, pages: 1 })).toEqual({ scope: null, pages: null })
  })
})

describe('mailSelection', () => {
  it('falls back to the current folder when the URL has no `in`', () => {
    expect(mailSelectionFromQuery({ uid: '42' }, 'INBOX')).toEqual({ uid: 42, mailbox: 'INBOX' })
    expect(mailSelectionFromQuery({ uid: '42', in: 'Folders/Work' }, 'INBOX')).toEqual({ uid: 42, mailbox: 'Folders/Work' })
  })

  it('ignores missing or invalid uids', () => {
    expect(mailSelectionFromQuery({}, 'INBOX')).toBeUndefined()
    expect(mailSelectionFromQuery({ uid: '0' }, 'INBOX')).toBeUndefined()
    expect(mailSelectionFromQuery({ uid: 'abc' }, 'INBOX')).toBeUndefined()
  })

  it('only carries `in` when the mailbox differs from the current folder', () => {
    expect(mailSelectionToQuery({ uid: 7, mailbox: 'INBOX' }, 'INBOX')).toEqual({ uid: '7', in: null })
    expect(mailSelectionToQuery({ uid: 7, mailbox: 'Folders/Work' }, 'INBOX')).toEqual({ uid: '7', in: 'Folders/Work' })
    expect(mailSelectionToQuery(null, 'INBOX')).toEqual({ uid: null, in: null })
  })

  it('matches a hit on uid and mailbox, so folders cannot collide', () => {
    const selection = { uid: 7, mailbox: 'Folders/Work' }

    expect(isSelectedMail(mail(7, 'Folders/Work'), selection)).toBe(true)
    expect(isSelectedMail(mail(7, 'INBOX'), selection)).toBe(false)
    expect(isSelectedMail(mail(8, 'Folders/Work'), selection)).toBe(false)
    expect(isSelectedMail(mail(7, 'Folders/Work'), undefined)).toBe(false)
  })
})
