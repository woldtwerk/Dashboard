import { describe, expect, it } from 'vitest'
import type { MailSummary } from '../shared/types/mail'
import { accordionItems, defaultExpanded } from '../app/utils/mail-conversation-view'
import { mailKey } from '../app/utils/mail'

const mail = (uid: number, date: string, overrides: Partial<MailSummary> = {}): MailSummary => ({
  uid,
  mailbox: 'INBOX',
  subject: `Mail ${uid}`,
  from: [{ name: `Sender ${uid}`, address: `sender${uid}@example.com` }],
  date,
  unread: false,
  flagged: false,
  ...overrides
})

describe('defaultExpanded', () => {
  it('opens the newest mail only', () => {
    const mails = [
      mail(3, '2026-10-16T12:00:00Z'),
      mail(1, '2026-10-16T10:00:00Z'),
      mail(2, '2026-10-16T11:00:00Z')
    ]

    expect(defaultExpanded(mails)).toEqual([mailKey(mails[0]!)])
  })

  it('does not depend on the order it receives', () => {
    const mails = [
      mail(1, '2026-10-16T10:00:00Z'),
      mail(2, '2026-10-16T12:00:00Z'),
      mail(3, '2026-10-16T11:00:00Z')
    ]

    expect(defaultExpanded(mails)).toEqual([mailKey(mails[1]!)])
  })

  it('has nothing to open without mails', () => {
    expect(defaultExpanded([])).toEqual([])
  })
})

describe('accordionItems', () => {
  it('lists the mails oldest first', () => {
    const mails = [
      mail(2, '2026-10-16T12:00:00Z'),
      mail(1, '2026-10-16T10:00:00Z')
    ]

    expect(accordionItems(mails).map(item => item.value)).toEqual([mailKey(mails[1]!), mailKey(mails[0]!)])
  })

  it('labels a row with the sender and strips reply and list prefixes', () => {
    const [item] = accordionItems([mail(1, '2026-10-16T10:00:00Z', {
      subject: 'Re: [Security-news] Re[2]: Drupal core update',
      snippet: 'A security release is available'
    })])

    expect(item).toMatchObject({
      label: 'Drupal core update',
      sender: 'Sender 1',
      isOwn: false,
      snippet: 'A security release is available'
    })
  })

  it('falls back to the address and an empty excerpt', () => {
    const [item] = accordionItems([mail(1, '2026-10-16T10:00:00Z', {
      from: [{ address: 'list@example.com' }]
    })])

    expect(item).toMatchObject({ sender: 'list@example.com', snippet: '' })
  })

  it('shows own mail as "me", by address or by sent mailbox', () => {
    const byAddress = accordionItems([mail(1, '2026-10-16T10:00:00Z', {
      from: [{ name: 'Me', address: 'me@example.com' }]
    })], { ownAddress: 'me@example.com' })

    const byMailbox = accordionItems([mail(2, '2026-10-16T11:00:00Z', {
      mailbox: 'Sent',
      from: [{ name: 'Me', address: 'me@example.com' }]
    })], { sentMailboxes: ['Sent'] })

    expect(byAddress[0]).toMatchObject({ sender: 'me', isOwn: true })
    expect(byMailbox[0]).toMatchObject({ sender: 'me', isOwn: true })
  })
})
