import { describe, expect, it } from 'vitest'
import {
  importanceReasons,
  mailImportanceRank,
  rankImportantMails
} from '../shared/mail-importance'
import type { MailImportanceContext, MailImportanceSource } from '../shared/mail-importance'

const contact = 'alice@example.com'
const own = 'me@example.com'

const context: MailImportanceContext = {
  contacts: new Set([contact]),
  ownAddress: own
}

function mail(overrides: Partial<MailImportanceSource> = {}): MailImportanceSource {
  return {
    mailbox: 'INBOX',
    unread: true,
    flagged: false,
    subject: 'Hello',
    from: [{ address: 'someone@example.com' }],
    to: [{ address: own }],
    date: '2026-10-18T10:00:00.000Z',
    ...overrides
  }
}

describe('importanceReasons', () => {
  it('marks a flagged unread inbox mail', () => {
    expect(importanceReasons(mail({ flagged: true }), context)).toEqual(['Starred'])
  })

  it('matches contacts case-insensitively and in any sender position', () => {
    const from = [{ address: 'other@example.com' }, { name: 'Alice', address: 'ALICE@example.com' }]
    expect(importanceReasons(mail({ from }), context)).toEqual(['Contact'])
  })

  it('marks a reply to the own address as the sole recipient', () => {
    expect(importanceReasons(mail({ subject: 'Re: Lunch' }), context)).toEqual(['Reply'])
    expect(importanceReasons(mail({ subject: '  AW: Lunch' }), context)).toEqual(['Reply'])
  })

  it('does not mark a reply sent to more recipients', () => {
    const to = [{ address: own }, { address: 'someone-else@example.com' }]
    expect(importanceReasons(mail({ subject: 'Re: Lunch', to }), context)).toEqual([])
  })

  it('does not mark a mail without a reply prefix', () => {
    expect(importanceReasons(mail({ subject: 'Lunch' }), context)).toEqual([])
    expect(importanceReasons(mail({ subject: 'Fwd: Lunch' }), context)).toEqual([])
  })

  it('does not mark a reply without a known own address', () => {
    expect(importanceReasons(mail({ subject: 'Re: Lunch' }), { contacts: new Set() })).toEqual([])
  })

  it('lists every reason, strongest first', () => {
    const from = [{ address: contact }]
    expect(importanceReasons(mail({ from, flagged: true, subject: 'Re: Lunch' }), context)).toEqual(['Starred', 'Contact', 'Reply'])
  })

  it('leaves read mail and mail outside the inbox out', () => {
    expect(importanceReasons(mail({ unread: false }), context)).toEqual([])
    expect(importanceReasons(mail({ mailbox: 'Archive', flagged: true }), context)).toEqual([])
  })
})

describe('mailImportanceRank', () => {
  it('ranks flagged before contacts and replies', () => {
    const from = [{ address: contact }]
    expect(mailImportanceRank(mail({ flagged: true }), context)).toBe(0)
    expect(mailImportanceRank(mail({ from }), context)).toBe(1)
    expect(mailImportanceRank(mail({ subject: 'Re: Lunch' }), context)).toBe(2)
  })

  it('uses the strongest reason when a mail has several', () => {
    const from = [{ address: contact }]
    expect(mailImportanceRank(mail({ from, subject: 'Re: Lunch' }), context)).toBe(1)
  })

  it('returns undefined for mail that is not important', () => {
    expect(mailImportanceRank(mail(), context)).toBeUndefined()
  })
})

describe('rankImportantMails', () => {
  const older = '2026-10-17T10:00:00.000Z'
  const newer = '2026-10-18T10:00:00.000Z'

  it('filters, ranks and sorts the important mails', () => {
    const fromContact = [{ address: contact }]
    const ranked = rankImportantMails([
      mail({ subject: 'Re: older', date: older }),
      mail({ subject: 'Re: newer', date: newer }),
      mail({ from: fromContact, subject: 'Contact', date: older }),
      mail({ flagged: true, subject: 'Flagged', date: older }),
      mail({ subject: 'Read', unread: false }),
      mail({ subject: 'Not inbox', mailbox: 'Archive' })
    ], context)

    expect(ranked.map(item => item.subject)).toEqual(['Flagged', 'Contact', 'Re: newer', 'Re: older'])
    expect(ranked.map(item => item.reasons)).toEqual([['Starred'], ['Contact'], ['Reply'], ['Reply']])
  })

  it('handles unparsable dates without splitting the order', () => {
    const ranked = rankImportantMails([
      mail({ flagged: true, date: 'not a date' }),
      mail({ flagged: true, date: newer })
    ], context)

    expect(ranked.map(item => item.reasons)).toEqual([['Starred'], ['Starred']])
    expect(ranked.map(item => item.date)).toEqual([newer, 'not a date'])
  })
})
