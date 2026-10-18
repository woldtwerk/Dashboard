import { describe, expect, it } from 'vitest'
import type { MailMessage } from '../shared/types/mail'
import { newMailNotification } from '../server/utils/mail-notifications'

const mail = (uid: number, name: string, subject: string): MailMessage => ({
  uid,
  mailbox: 'INBOX',
  subject,
  from: [{ name, address: `${name.toLowerCase()}@example.com` }],
  to: [],
  cc: [],
  date: '2026-10-20T10:00:00.000Z',
  unread: true,
  flagged: false
})

describe('newMailNotification', () => {
  it('sends nothing without new mail', () => {
    expect(newMailNotification('service-1', [])).toBeUndefined()
  })

  it('uses the sender and subject for a single mail', () => {
    expect(newMailNotification('service-1', [mail(42, 'Alice', 'Lunch?')])).toEqual({
      category: 'mail-new',
      title: 'Alice',
      body: 'Lunch?',
      to: '/mail?service=service-1&mailbox=INBOX&uid=42',
      domain: 'mail',
      service: 'service-1',
      dedupeKey: 'mail-new:service-1:42'
    })
  })

  it('summarizes several mails with their first two senders', () => {
    const notification = newMailNotification('service-1', [
      mail(42, 'Alice', 'One'),
      mail(43, 'Bob', 'Two'),
      mail(44, 'Carol', 'Three')
    ])

    expect(notification).toMatchObject({
      title: '3 new mails',
      body: 'Alice, Bob',
      dedupeKey: 'mail-new:service-1:44',
      to: '/mail?service=service-1&mailbox=INBOX&uid=44'
    })
  })
})
