import { describe, expect, it } from 'vitest'
import type { MailMessage, MailSummary } from '../shared/types/mail'
import {
  conversationKeys,
  conversationKind,
  conversationParticipantLabel,
  groupConversations,
  isOwnMail,
  isStreamKey,
  mailStreamFlags,
  normalizeListId,
  normalizeMessageId,
  normalizeSubject,
  parseRawStreamHeaders,
  streamLabel,
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

  it('adds a list key to a mailing list mail, in place of a sender key', () => {
    expect(conversationKeys(mail({
      messageId: '<advisory@drupal.org>',
      listId: 'security-news.drupal.org',
      bulk: true
    }))).toEqual([
      'subj:sender@example.com:subject',
      'id:advisory@drupal.org',
      'list:security-news.drupal.org'
    ])
  })

  it('adds a sender key only to bulk mail without a list id', () => {
    expect(conversationKeys(mail({ from: [{ address: 'news@example.com' }], bulk: true })))
      .toEqual(['subj:news@example.com:subject', 'from:news@example.com'])
    expect(conversationKeys(mail({ from: [{ address: 'news@example.com' }] })))
      .toEqual(['subj:news@example.com:subject'])
  })

  it('carries the list key on a reply too', () => {
    expect(conversationKeys(mail({ inReplyTo: '<root@drupal.org>', listId: 'security-news.drupal.org' })))
      .toEqual(['id:root@drupal.org', 'list:security-news.drupal.org'])
  })
})

describe('normalizeListId', () => {
  it('keeps the part in angle brackets, lower-cased', () => {
    expect(normalizeListId('Drupal Security News <Security-News.Drupal.org>')).toBe('security-news.drupal.org')
    expect(normalizeListId('<list.example.com>')).toBe('list.example.com')
  })

  it('falls back to the whole value without brackets, and ignores an empty one', () => {
    expect(normalizeListId(' List.Example.com ')).toBe('list.example.com')
    expect(normalizeListId(undefined)).toBeUndefined()
    expect(normalizeListId('')).toBeUndefined()
  })
})

describe('mailStreamFlags', () => {
  const person = [{ name: 'Jane', address: 'jane@example.com' }]

  it('reads the List-Id and its description', () => {
    expect(mailStreamFlags(person, { listId: 'Drupal Security News <security-news.drupal.org>' })).toEqual({
      listId: 'security-news.drupal.org',
      listName: 'Drupal Security News',
      bulk: false
    })
  })

  it.each([
    ['a List-Unsubscribe header', { listUnsubscribe: '<mailto:unsub@example.com>' }],
    ['Precedence: bulk', { precedence: 'bulk' }],
    ['Precedence: list', { precedence: 'list' }],
    ['Precedence: junk', { precedence: 'junk' }],
    ['an Auto-Submitted other than no', { autoSubmitted: 'auto-generated' }]
  ])('marks bulk mail by %s', (_name, headers) => {
    expect(mailStreamFlags(person, headers).bulk).toBe(true)
  })

  it('leaves Auto-Submitted: no as personal mail', () => {
    expect(mailStreamFlags(person, { autoSubmitted: 'no' }).bulk).toBe(false)
  })

  it.each(['no-reply', 'noreply', 'notifications', 'notification', 'newsletter', 'news', 'mailer-daemon', 'updates', 'update', 'alerts', 'alert', 'info'])('marks the machine sender %s@ as bulk', (local) => {
    expect(mailStreamFlags([{ address: `${local}@example.com` }], {}).bulk).toBe(true)
  })

  it('keeps a normal person personal', () => {
    expect(mailStreamFlags(person, {}).bulk).toBe(false)
    expect(mailStreamFlags([{ address: 'info123@example.com' }], {}).bulk).toBe(false)
  })
})

describe('parseRawStreamHeaders', () => {
  it('reads the stream headers from a raw block and joins folded lines', () => {
    const raw = [
      'From: Example News <news@example.com>',
      'List-Id: Example News',
      ' <news.example.com>',
      'Precedence: bulk',
      'Subject: Issue 12'
    ].join('\r\n')

    expect(parseRawStreamHeaders(raw)).toEqual({
      listId: 'Example News <news.example.com>',
      listUnsubscribe: undefined,
      precedence: 'bulk',
      autoSubmitted: undefined
    })
  })
})

describe('streamLabel', () => {
  it('prefers the List-Id description', () => {
    expect(streamLabel({ from: [{ name: 'Drupal Security Team', address: 'security-news@drupal.org' }], listName: 'Drupal Security News' })).toBe('Drupal Security News')
  })

  it('falls back to the sender display name or address', () => {
    expect(streamLabel({ from: [{ name: 'Example News', address: 'news@example.com' }] })).toBe('Example News')
    expect(streamLabel({ from: [{ address: 'news@example.com' }] })).toBe('news@example.com')
    expect(streamLabel({ from: [] })).toBe('Unknown')
  })
})

describe('conversationKind', () => {
  it('is a stream for a list or bulk sender key', () => {
    expect(conversationKind({ key: 'list:security-news.drupal.org' })).toBe('stream')
    expect(conversationKind({ key: 'from:news@example.com' })).toBe('stream')
  })

  it('is a thread otherwise', () => {
    expect(conversationKind({ key: 'id:root@example.com' })).toBe('thread')
    expect(conversationKind({ key: 'subj:a@a.com:subject' })).toBe('thread')
    expect(isStreamKey('subj:a@a.com:from:x')).toBe(false)
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

  it('groups a whole mailing list into one stream, whatever the subject', () => {
    const subjects = [
      '[Security-news] Entity List - Critical - …',
      '[Security-news] Gin Admin Theme - …',
      '[Security-news] Drupal core - …',
      '[Security-news] Webform - …',
      '[Security-news] Paragraphs - …'
    ]
    const groups = groupConversations(subjects.map((subject, index) => mail({
      uid: index + 1,
      subject,
      messageId: `<sa-${index + 1}@drupal.org>`,
      from: [{ name: 'Drupal Security Team', address: 'security-news@drupal.org' }],
      listId: 'security-news.drupal.org',
      bulk: true,
      date: `2026-10-${String(10 + index).padStart(2, '0')}T10:00:00.000Z`
    })))

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: 'list:security-news.drupal.org', count: 5 })
    expect(groups[0]!.mails.map(item => item.uid)).toEqual([1, 2, 3, 4, 5])
  })

  it('groups bulk mail without a List-Id by its sender', () => {
    const groups = groupConversations([
      mail({ uid: 1, subject: 'Issue 12', from: [{ address: 'news@example.com' }], messageId: '<n1@example.com>', bulk: true }),
      mail({ uid: 2, subject: 'Issue 13', from: [{ address: 'news@example.com' }], messageId: '<n2@example.com>', bulk: true }),
      mail({ uid: 3, subject: 'Hello', from: [{ address: 'jane@example.com' }], messageId: '<p1@example.com>' })
    ])

    expect(groups).toHaveLength(2)
    const stream = groups.find(group => group.key === 'from:news@example.com')
    expect(stream).toMatchObject({ count: 2 })
    expect(conversationKind(stream!)).toBe('stream')
  })

  it('keeps two personal mails from one person with different subjects apart', () => {
    const groups = groupConversations([
      mail({ uid: 1, subject: 'Lunch?', from: [{ address: 'jane@example.com' }], messageId: '<p1@example.com>' }),
      mail({ uid: 2, subject: 'Invoice', from: [{ address: 'jane@example.com' }], messageId: '<p2@example.com>' })
    ])

    expect(groups).toHaveLength(2)
    expect(groups.every(group => conversationKind(group) === 'thread')).toBe(true)
  })

  it('joins a reply to a list mail into the list stream via References', () => {
    const groups = groupConversations([
      mail({ uid: 1, subject: '[Security-news] Advisory', messageId: '<advisory@drupal.org>', from: [{ address: 'security-news@drupal.org' }], listId: 'security-news.drupal.org', bulk: true }),
      mail({ uid: 2, subject: 'Re: [Security-news] Advisory', references: ['<advisory@drupal.org>'], messageId: '<reply@example.com>' })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: 'list:security-news.drupal.org', count: 2 })
    expect(conversationKind(groups[0]!)).toBe('stream')
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
