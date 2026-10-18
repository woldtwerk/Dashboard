import { describe, expect, it } from 'vitest'
import type { Mailbox } from '../shared/types/mail'
import { forgottenMailboxes, isSkippedMailbox, searchableMailboxes, syncMailboxes } from '../server/utils/mail-sync'

const mailbox = (path: string, extra: Partial<Mailbox> = {}): Mailbox => ({
  path,
  name: path,
  total: 0,
  unread: 0,
  ...extra
})

describe('isSkippedMailbox', () => {
  it('skips only the virtual folders that repeat other mail', () => {
    expect(isSkippedMailbox(mailbox('All Mail', { specialUse: '\\All' }))).toBe(true)
    expect(isSkippedMailbox(mailbox('Starred', { specialUse: '\\Flagged' }))).toBe(true)
    expect(isSkippedMailbox(mailbox('INBOX', { specialUse: '\\Inbox' }))).toBe(false)
    expect(isSkippedMailbox(mailbox('Folders/Work'))).toBe(false)
  })
})

describe('syncMailboxes', () => {
  it('indexes real folders and labels, but not the virtual folders', () => {
    const mailboxes = [
      mailbox('INBOX', { specialUse: '\\Inbox' }),
      mailbox('All Mail', { specialUse: '\\All' }),
      mailbox('Starred', { specialUse: '\\Flagged' }),
      mailbox('Labels/Receipts', { label: true }),
      mailbox('Folders/Work')
    ]

    expect(syncMailboxes(mailboxes).map(item => item.path)).toEqual(['INBOX', 'Labels/Receipts', 'Folders/Work'])
  })
})

describe('searchableMailboxes', () => {
  it('leaves out labels and virtual folders, so no mail is listed twice', () => {
    const mailboxes = [
      mailbox('INBOX', { specialUse: '\\Inbox' }),
      mailbox('Labels/Receipts', { label: true }),
      mailbox('All Mail', { specialUse: '\\All' }),
      mailbox('Folders/Work')
    ]

    expect(searchableMailboxes(mailboxes)).toEqual(['INBOX', 'Folders/Work'])
  })
})

describe('forgottenMailboxes', () => {
  it('forgets a known folder the server dropped or that is skipped now', () => {
    const known = ['INBOX', 'All Mail', 'Starred', 'Gone']
    const mailboxes = [mailbox('INBOX', { specialUse: '\\Inbox' })]

    expect(forgottenMailboxes(known, mailboxes)).toEqual(['All Mail', 'Starred', 'Gone'])
  })

  it('forgets nothing while every known folder is still synced', () => {
    const mailboxes = [mailbox('INBOX'), mailbox('Folders/Work')]

    expect(forgottenMailboxes(['INBOX', 'Folders/Work'], mailboxes)).toEqual([])
  })
})
