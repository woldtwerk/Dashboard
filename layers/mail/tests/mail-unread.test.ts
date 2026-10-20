import { describe, expect, it } from 'vitest'
import type { Mailbox } from '../shared/types/mail'
import { countUnread, isRepeatedMailbox } from '../app/utils/mail-unread'

const mailbox = (path: string, extra: Partial<Mailbox> = {}): Mailbox => ({
  path,
  name: path,
  total: 0,
  unread: 0,
  ...extra
})

describe('isRepeatedMailbox', () => {
  it('marks labels and the virtual folders as repeats', () => {
    expect(isRepeatedMailbox(mailbox('Labels/Receipts', { label: true }))).toBe(true)
    expect(isRepeatedMailbox(mailbox('All Mail', { specialUse: '\\All' }))).toBe(true)
    expect(isRepeatedMailbox(mailbox('Starred', { specialUse: '\\Flagged' }))).toBe(true)
    expect(isRepeatedMailbox(mailbox('INBOX', { specialUse: '\\Inbox' }))).toBe(false)
    expect(isRepeatedMailbox(mailbox('Folders/Work'))).toBe(false)
  })
})

describe('countUnread', () => {
  it('sums the real folders only, so a repeated mail counts once', () => {
    const mailboxes = [
      mailbox('INBOX', { specialUse: '\\Inbox', unread: 5 }),
      mailbox('Folders/Work', { unread: 2 }),
      mailbox('Labels/Receipts', { label: true, unread: 4 }),
      mailbox('All Mail', { specialUse: '\\All', unread: 11 })
    ]

    expect(countUnread(mailboxes)).toBe(7)
  })

  it('is zero without unread mail', () => {
    expect(countUnread([mailbox('INBOX', { specialUse: '\\Inbox' })])).toBe(0)
    expect(countUnread([])).toBe(0)
  })
})
