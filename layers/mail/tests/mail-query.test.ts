import { describe, expect, it } from 'vitest'
import type { MailConversation, MailSummary } from '../shared/types/mail'
import { isSelectedMail, mailComposeFromQuery, mailComposeToQuery, mailConversationFromQuery, mailConversationToQuery, mailListFromQuery, mailListToQuery, mailSearchFromQuery, mailSearchToApiQuery, mailSearchToQuery, mailSelectionFromQuery, mailSelectionToQuery, mailViewFromQuery, mailViewToQuery, mergeConversations, mergePage, nextPageState, restoreRequests } from '../app/utils/mail-query'

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

describe('mailView', () => {
  it('reads and writes the conversations view', () => {
    expect(mailViewFromQuery({})).toBe('mails')
    expect(mailViewFromQuery({ view: 'threads' })).toBe('threads')
    expect(mailViewFromQuery({ view: 'other' })).toBe('mails')
    expect(mailViewToQuery('threads')).toEqual({ view: 'threads', conversation: null, uid: null, in: null })
    expect(mailViewToQuery('mails')).toEqual({ view: null, conversation: null, uid: null, in: null })
  })
})

describe('mailConversation', () => {
  it('reads the open conversation and clears the mail selection when it changes', () => {
    expect(mailConversationFromQuery({})).toBeUndefined()
    expect(mailConversationFromQuery({ conversation: 'id:root@example.com' })).toBe('id:root@example.com')
    expect(mailConversationToQuery('subj:a@b.com:hello world')).toEqual({ conversation: 'subj:a@b.com:hello world', uid: null, in: null })
    expect(mailConversationToQuery(null)).toEqual({ conversation: null, uid: null, in: null })
  })
})

describe('nextPageState', () => {
  it('advances the offset by what arrived', () => {
    expect(nextPageState({ offset: 0, done: false }, 50, 50)).toEqual({ offset: 50, done: false })
    expect(nextPageState({ offset: 200, done: false }, 50, 50)).toEqual({ offset: 250, done: false })
  })

  it('is done when the page was short', () => {
    expect(nextPageState({ offset: 50, done: false }, 30, 50)).toEqual({ offset: 80, done: true })
    expect(nextPageState({ offset: 0, done: false }, 0, 50)).toEqual({ offset: 0, done: true })
  })
})

describe('restoreRequests', () => {
  it('lists one offset per page, in order', () => {
    expect(restoreRequests(1, 50)).toEqual([0])
    expect(restoreRequests(5, 50)).toEqual([0, 50, 100, 150, 200])
  })

  it('is empty without pages', () => {
    expect(restoreRequests(0, 50)).toEqual([])
    expect(restoreRequests(-3, 50)).toEqual([])
  })
})

describe('mergePage', () => {
  it('appends a page and drops mails already loaded', () => {
    expect(mergePage([mail(1, 'INBOX'), mail(2, 'INBOX')], [mail(2, 'INBOX'), mail(3, 'INBOX')]).map(item => item.uid))
      .toEqual([1, 2, 3])
  })

  it('keeps the mailbox in the key, so equal uids in another folder both stay', () => {
    expect(mergePage([mail(1, 'INBOX')], [mail(1, 'Sent')]).map(item => item.mailbox))
      .toEqual(['INBOX', 'Sent'])
  })

  it('is a no-op for an empty page', () => {
    const list = [mail(1, 'INBOX')]
    expect(mergePage(list, [])).toEqual(list)
  })
})

describe('mergeConversations', () => {
  const conversation = (key: string): MailConversation => ({
    key,
    subject: key,
    participants: [],
    count: 1,
    unread: false,
    latest: mail(1, 'INBOX')
  })

  it('appends groups and drops duplicates by key', () => {
    expect(mergeConversations([conversation('a'), conversation('b')], [conversation('b'), conversation('c')]).map(group => group.key))
      .toEqual(['a', 'b', 'c'])
  })
})

describe('mailComposeFromQuery', () => {
  it('opens a fresh composer from compose=new', () => {
    expect(mailComposeFromQuery({ compose: 'new' }, 'INBOX')).toEqual({ mode: 'new' })
  })

  it('reads the mail a reply answers, from uid and in', () => {
    expect(mailComposeFromQuery({ compose: 'replyAll', uid: '42', in: 'Archive' }, 'INBOX'))
      .toEqual({ mode: 'replyAll', uid: 42, mailbox: 'Archive' })
    expect(mailComposeFromQuery({ compose: 'forward', uid: '42' }, 'INBOX'))
      .toEqual({ mode: 'forward', uid: 42, mailbox: 'INBOX' })
  })

  it('ignores an unknown mode or a missing uid', () => {
    expect(mailComposeFromQuery({}, 'INBOX')).toBeUndefined()
    expect(mailComposeFromQuery({ compose: 'draft' }, 'INBOX')).toBeUndefined()
    expect(mailComposeFromQuery({ compose: 'reply' }, 'INBOX')).toBeUndefined()
    expect(mailComposeFromQuery({ compose: 'reply', uid: '0' }, 'INBOX')).toBeUndefined()
  })
})

describe('mailComposeToQuery', () => {
  it('keeps the open mail when the composer closes', () => {
    expect(mailComposeToQuery(null, 'INBOX')).toEqual({ compose: null })
  })

  it('leaves the selection alone for a fresh mail', () => {
    expect(mailComposeToQuery({ mode: 'new' }, 'INBOX')).toEqual({ compose: 'new' })
  })

  it('names the replied-to mail, dropping a redundant folder', () => {
    expect(mailComposeToQuery({ mode: 'reply', uid: 42, mailbox: 'INBOX' }, 'INBOX'))
      .toEqual({ compose: 'reply', uid: '42', in: null })
    expect(mailComposeToQuery({ mode: 'reply', uid: 42, mailbox: 'Archive' }, 'INBOX'))
      .toEqual({ compose: 'reply', uid: '42', in: 'Archive' })
  })
})
