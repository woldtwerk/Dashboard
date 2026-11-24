import { describe, expect, it } from 'vitest'
import type { MailSummary } from '../shared/types/mail'
import {
  holdDeleted,
  MAIL_DELETE_HOLD_MS,
  releaseDeleted,
  withoutDeleted,
  type RecentlyDeleted
} from '../app/utils/mail-delete-guard'
import { mailKey } from '../app/utils/mail'

const NOW = Date.parse('2026-10-16T10:00:00Z')

const mail = (uid: number, options: { mailbox?: string, messageId?: string } = {}): MailSummary => ({
  uid,
  mailbox: options.mailbox ?? 'INBOX',
  messageId: options.messageId,
  subject: `Mail ${uid}`,
  from: [],
  date: '2026-10-16T10:00:00Z',
  unread: false,
  flagged: false
})

const state = (): RecentlyDeleted => new Map()

describe('withoutDeleted', () => {
  it('drops a held mail from a reloaded list', () => {
    const deleted = state()
    holdDeleted(deleted, mail(5), NOW)

    expect(withoutDeleted([mail(6), mail(5)], deleted, NOW)).toEqual([mail(6)])
  })

  it('drops a copy that comes back under another uid with the same Message-ID', () => {
    const deleted = state()
    holdDeleted(deleted, mail(5, { messageId: '<one@example.com>' }), NOW)

    expect(withoutDeleted([mail(9, { mailbox: 'Archive', messageId: '<one@example.com>' })], deleted, NOW)).toEqual([])
  })

  it('matches a mail without a Message-ID by key only', () => {
    const deleted = state()
    holdDeleted(deleted, mail(5), NOW)

    // Another mail of the same mailbox, and the same uid in another mailbox, stay
    expect(withoutDeleted([mail(6), mail(5, { mailbox: 'Archive' })], deleted, NOW)).toHaveLength(2)
  })

  it('returns the same list instance when nothing was dropped', () => {
    const deleted = state()
    const list = [mail(1), mail(2)]

    expect(withoutDeleted(list, deleted, NOW)).toBe(list)

    holdDeleted(deleted, mail(5), NOW)
    expect(withoutDeleted(list, deleted, NOW)).toBe(list)
  })

  it('shows the mail again right after a release', () => {
    const deleted = state()
    const held = mail(5)
    holdDeleted(deleted, held, NOW)
    releaseDeleted(deleted, mailKey(held))

    expect(withoutDeleted([held], deleted, NOW)).toEqual([held])
  })

  it('stops hiding the mail once the hold has passed', () => {
    const deleted = state()
    holdDeleted(deleted, mail(5), NOW)

    expect(withoutDeleted([mail(5)], deleted, NOW + MAIL_DELETE_HOLD_MS - 1)).toEqual([])
    expect(withoutDeleted([mail(5)], deleted, NOW + MAIL_DELETE_HOLD_MS)).toEqual([mail(5)])
  })
})
