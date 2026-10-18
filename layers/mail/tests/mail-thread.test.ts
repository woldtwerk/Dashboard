import { describe, expect, it } from 'vitest'
import type { MailMessage, MailSummary } from '../shared/types/mail'
import {
  conversationKeys,
  conversationParticipantLabel,
  groupConversations,
  isOwnMail,
  normalizeMessageId,
  normalizeSubject,
  splitQuoted,
  stripSubjectPrefix
} from '../shared/mail-thread'

const mail = (overrides: Partial<MailMessage> = {}): MailMessage => ({
  uid: overrides.uid ?? 1,
  mailbox: overrides.mailbox ?? 'INBOX',
  subject: 'Subject',
  from: [{ name: 'Sender', address: 'sender@example.com' }],
  to: [{ address: 'me@example.com' }],
  cc: [],
  date: '2026-10-16T10:00:00.000Z',
  unread: false,
  flagged: false,
  ...overrides
})

describe('normalizeSubject', () => {
  it('strips any number and case of reply and forward prefixes', () => {
    expect(normalizeSubject('Re: AW: Fwd: Fw: WG: Wtr: Antw: Subject')).toBe('subject')
    expect(normalizeSubject('RE[2]: Re: Subject')).toBe('subject')
    expect(normalizeSubject('  Re :   Subject  ')).toBe('subject')
  })

  it('strips leading bracketed list tags', () => {
    expect(normalizeSubject('[Security-news] Re: [announce] Subject')).toBe('subject')
  })

  it('keeps numbers', () => {
    expect(normalizeSubject('Rechnung 12345 für 2026')).toBe('rechnung 12345 für 2026')
    expect(normalizeSubject('[123] Rechnung')).toBe('[123] rechnung')
    expect(normalizeSubject('Re: KFZ Kasnevitz: New release(s) available')).toBe('kfz kasnevitz: new release(s) available')
  })
})

describe('stripSubjectPrefix', () => {
  it('keeps the case and only removes the prefixes', () => {
    expect(stripSubjectPrefix('Re: [Security-news] Important')).toBe('Important')
  })
})

describe('normalizeMessageId', () => {
  it('drops angle brackets and lower-cases', () => {
    expect(normalizeMessageId(' <ABC@Example.COM> ')).toBe('abc@example.com')
    expect(normalizeMessageId('')).toBeUndefined()
  })
})

describe('conversationKeys', () => {
  it('gives a non-reply its subject key and its own id key', () => {
    expect(conversationKeys(mail({ messageId: '<root@example.com>', subject: 'Re: Hello' }))).toEqual([
      'subj:sender@example.com:hello',
      'id:root@example.com'
    ])
  })

  it('gives a reply the id key of its thread root', () => {
    expect(conversationKeys(mail({ inReplyTo: '<root@example.com>', messageId: '<reply@example.com>' }))).toEqual(['id:root@example.com'])
    expect(conversationKeys(mail({ references: ['<root@example.com>', '<mid@example.com>'] }))).toEqual(['id:root@example.com'])
  })

  it('without reply headers and without a Message-ID only gives the subject key', () => {
    expect(conversationKeys(mail({ messageId: undefined }))).toEqual(['subj:sender@example.com:subject'])
  })
})

describe('groupConversations', () => {
  const summaries = (messages: MailMessage[]): MailSummary[] => messages

  it('groups the recurring KFZ notifications from one sender into one conversation', () => {
    const mails = summaries([1, 2, 3, 4, 5].map(index => mail({
      uid: index,
      subject: `New release(s) available for KFZ Kasnevitz ${index}`,
      messageId: `<kfz-${index}@example.com>`,
      date: `2026-10-${String(10 + index).padStart(2, '0')}T10:00:00.000Z`
    })))

    // Different subjects stay apart; the same subject groups
    const same = summaries([1, 2, 3, 4, 5].map(index => mail({
      uid: index,
      subject: 'New release(s) available for KFZ Kasnevitz',
      messageId: `<kfz-${index}@example.com>`,
      date: `2026-10-${String(10 + index).padStart(2, '0')}T10:00:00.000Z`
    })))

    expect(groupConversations(mails)).toHaveLength(5)
    const groups = groupConversations(same)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ count: 5, unread: false })
    expect(groups[0]!.mails.map(item => item.uid)).toEqual([1, 2, 3, 4, 5])
  })

  it('unites reply chains that point at the same root, across INBOX and Sent', () => {
    const root = mail({ uid: 1, mailbox: 'Sent', messageId: '<root@example.com>', subject: 'Re: Project', from: [{ address: 'me@example.com' }], date: '2026-10-01T10:00:00.000Z' })
    const reply = mail({ uid: 2, mailbox: 'INBOX', subject: 'Re: Project', inReplyTo: '<root@example.com>', messageId: '<reply@example.com>', date: '2026-10-02T10:00:00.000Z' })
    const deepReply = mail({ uid: 3, mailbox: 'INBOX', subject: 'Re: Project', references: ['<root@example.com>'], messageId: '<deep@example.com>', date: '2026-10-03T10:00:00.000Z' })

    const groups = groupConversations([reply, root, deepReply])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: 'id:root@example.com', count: 3, subject: 'Project' })
    expect(groups[0]!.mails.map(item => item.uid)).toEqual([1, 2, 3])
  })

  it('keeps two invoices with different numbers apart', () => {
    const groups = groupConversations([
      mail({ uid: 1, subject: 'Invoice 1001', messageId: '<a@netcup.de>', from: [{ address: 'billing@netcup.de' }] }),
      mail({ uid: 2, subject: 'Invoice 1002', messageId: '<b@netcup.de>', from: [{ address: 'billing@netcup.de' }] })
    ])

    expect(groups).toHaveLength(2)
  })

  it('groups reply and forward variants of one subject', () => {
    const groups = groupConversations([
      mail({ uid: 1, subject: 'Offer', messageId: '<offer@example.com>' }),
      mail({ uid: 2, subject: 'AW: Offer', inReplyTo: '<offer@example.com>' }),
      mail({ uid: 3, subject: 'Fwd: Offer', inReplyTo: '<offer@example.com>' })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.count).toBe(3)
  })

  it('groups a list-tagged subject with its untagged replies', () => {
    const groups = groupConversations([
      mail({ uid: 1, subject: '[Security-news] Advisory', messageId: '<advisory@example.com>' }),
      mail({ uid: 2, subject: 'Re: [Security-news] Advisory', inReplyTo: '<advisory@example.com>' })
    ])

    expect(groups).toHaveLength(1)
  })

  it('keeps mails from different senders with the same subject apart', () => {
    const groups = groupConversations([
      mail({ uid: 1, subject: 'Rechnung', messageId: '<a@a.com>', from: [{ address: 'a@a.com' }] }),
      mail({ uid: 2, subject: 'Rechnung', messageId: '<b@b.com>', from: [{ address: 'b@b.com' }] })
    ])

    expect(groups).toHaveLength(2)
  })

  it('uses the stored index keys and can join a root to the replies that name it', () => {
    const root: MailSummary = mail({ uid: 1, messageId: '<root@example.com>', conversationKeys: ['subj:a@a.com:topic', 'id:root@example.com'] })
    const reply: MailSummary = mail({ uid: 2, conversationKeys: ['id:root@example.com'] })

    const groups = groupConversations([root, reply])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.key).toBe('id:root@example.com')
    expect(groups[0]!.participants).toEqual([{ name: 'Sender', address: 'sender@example.com' }])
  })

  it('sorts groups newest first and mails oldest first', () => {
    const groups = groupConversations([
      mail({ uid: 1, subject: 'Older', messageId: '<a@a.com>', date: '2026-10-01T10:00:00.000Z' }),
      mail({ uid: 2, subject: 'Newer', messageId: '<b@b.com>', date: '2026-10-20T10:00:00.000Z' })
    ])

    expect(groups.map(group => group.subject)).toEqual(['Newer', 'Older'])
  })
})

describe('splitQuoted', () => {
  it('keeps a mail without quotes whole', () => {
    expect(splitQuoted('Hello\nworld')).toEqual({ body: 'Hello\nworld' })
  })

  it('splits at the first `>` line', () => {
    expect(splitQuoted('Thanks\n\n> earlier line\n> more')).toEqual({
      body: 'Thanks',
      quoted: '> earlier line\n> more'
    })
  })

  it('splits at an English attribution line', () => {
    expect(splitQuoted('Yes\nOn Mon, Jan 1, 2026 at 10:00 Jane <jane@x.com> wrote:\nold')).toEqual({
      body: 'Yes',
      quoted: 'On Mon, Jan 1, 2026 at 10:00 Jane <jane@x.com> wrote:\nold'
    })
  })

  it('splits at a German attribution line', () => {
    expect(splitQuoted('Klar\nAm 01.01.2026 um 10:00 schrieb Jane <jane@x.com>:\nalt')).toEqual({
      body: 'Klar',
      quoted: 'Am 01.01.2026 um 10:00 schrieb Jane <jane@x.com>:\nalt'
    })
  })

  it('handles missing text', () => {
    expect(splitQuoted()).toEqual({ body: '' })
    expect(splitQuoted('')).toEqual({ body: '' })
  })
})

describe('isOwnMail', () => {
  it('matches the account address or the Sent folder', () => {
    expect(isOwnMail(mail({ from: [{ address: 'me@example.com' }] }), { ownAddress: 'ME@example.com' })).toBe(true)
    expect(isOwnMail(mail({ from: [{ address: 'other@example.com' }], mailbox: 'Sent' }), { sentMailboxes: ['Sent'] })).toBe(true)
    expect(isOwnMail(mail({ from: [{ address: 'other@example.com' }] }), { ownAddress: 'me@example.com', sentMailboxes: ['Sent'] })).toBe(false)
  })
})

describe('conversationParticipantLabel', () => {
  it('shows the own address as "me"', () => {
    expect(conversationParticipantLabel({ name: 'Jane', address: 'me@example.com' }, 'me@example.com')).toBe('me')
    expect(conversationParticipantLabel({ name: 'Jane', address: 'jane@example.com' }, 'me@example.com')).toBe('Jane')
    expect(conversationParticipantLabel({ address: 'jane@example.com' })).toBe('jane@example.com')
  })
})
