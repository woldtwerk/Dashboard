import { describe, expect, it } from 'vitest'
import type { MailConversation, MailSummary } from '../shared/types/mail'
import { mailKey } from '../app/utils/mail'
import { expire, release, retain, retainConversation, visibleConversations, visibleMails, type RetainedConversations, type RetainedMails } from '../app/utils/mail-retention'

const mail = (uid: number, date: string, unread = false): MailSummary => ({
  uid,
  mailbox: 'INBOX',
  subject: `Mail ${uid}`,
  from: [],
  date,
  unread,
  flagged: false
})

const conversation = (key: string, date: string, unread = true): MailConversation => ({
  key,
  subject: key,
  participants: [],
  count: 1,
  unread,
  latest: mail(1, date, unread)
})

describe('retain', () => {
  it('keeps the mail, shown as read, with no deadline', () => {
    const state: RetainedMails = new Map()
    retain(state, mail(7, '2026-10-16T10:00:00Z', true))

    expect([...state.values()]).toEqual([{
      mail: { ...mail(7, '2026-10-16T10:00:00Z'), unread: false },
      until: null
    }])
  })

  it('retains a released mail again when it is reopened', () => {
    const state: RetainedMails = new Map()
    const opened = mail(7, '2026-10-16T10:00:00Z', true)

    retain(state, opened)
    release(state, mailKey(opened), 1000)
    retain(state, opened)

    expire(state, 1_000_000)
    expect(state.get(mailKey(opened))!.until).toBeNull()
    expect(state.size).toBe(1)
  })
})

describe('release and expire', () => {
  it('holds a released mail for three seconds by default', () => {
    const state: RetainedMails = new Map()
    const opened = mail(1, '2026-10-16T10:00:00Z', true)

    retain(state, opened)
    release(state, mailKey(opened), 1000)

    expire(state, 1000 + 2999)
    expect(state.size).toBe(1)

    expire(state, 1000 + 3000)
    expect(state.size).toBe(0)
  })

  it('honours an explicit delay', () => {
    const state: RetainedMails = new Map()
    const opened = mail(1, '2026-10-16T10:00:00Z')

    retain(state, opened)
    release(state, mailKey(opened), 0, 500)

    expire(state, 499)
    expect(state.size).toBe(1)

    expire(state, 500)
    expect(state.size).toBe(0)
  })

  it('keeps entries without a deadline and ignores unknown keys', () => {
    const state: RetainedMails = new Map()
    retain(state, mail(1, '2026-10-16T10:00:00Z'))

    release(state, 'INBOX/999', 0)
    expire(state, 1_000_000)

    expect(state.size).toBe(1)
  })
})

describe('visibleMails', () => {
  it('keeps a retained mail the refetch dropped, at its date position', () => {
    const state: RetainedMails = new Map()
    const opened = mail(1, '2026-10-16T10:00:00Z', true)
    retain(state, opened)

    const fetched = [mail(2, '2026-10-16T12:00:00Z', true), mail(3, '2026-10-16T08:00:00Z', true)]
    const visible = visibleMails(fetched, state, { unread: true })

    expect(visible.map(item => item.uid)).toEqual([2, 1, 3])
    expect(visible[1]).toEqual({ ...opened, unread: false })
  })

  it('preserves the fetched order and adds a retained mail at the end when oldest', () => {
    const state: RetainedMails = new Map()
    retain(state, mail(9, '2026-10-16T06:00:00Z', true))

    const fetched = [mail(2, '2026-10-16T12:00:00Z', true), mail(3, '2026-10-16T10:00:00Z', true)]

    expect(visibleMails(fetched, state, { unread: true }).map(item => item.uid)).toEqual([2, 3, 9])
  })

  it('lets a fetched mail win but shows a retained key as read', () => {
    const state: RetainedMails = new Map()
    retain(state, mail(1, '2026-10-16T10:00:00Z', true))

    const fetched = [mail(1, '2026-10-16T10:00:00Z', true)]
    const visible = visibleMails(fetched, state, { unread: true })

    expect(visible).toHaveLength(1)
    expect(visible[0]).toEqual({ ...fetched[0], unread: false })
  })

  it('hides a fetched read mail that is not retained', () => {
    const fetched = [mail(1, '2026-10-16T12:00:00Z', false), mail(2, '2026-10-16T10:00:00Z', true)]

    expect(visibleMails(fetched, new Map(), { unread: true }).map(item => item.uid)).toEqual([2])
  })

  it('shows a retained mail even after it was marked read', () => {
    const state: RetainedMails = new Map()
    const read = mail(1, '2026-10-16T12:00:00Z', false)
    retain(state, read)

    expect(visibleMails([], state, { unread: true })).toEqual([{ ...read, unread: false }])
    expect(visibleMails([read], state, { unread: true })).toEqual([{ ...read, unread: false }])
  })

  it('keeps read mails without the unread filter', () => {
    const state: RetainedMails = new Map()
    retain(state, mail(1, '2026-10-16T10:00:00Z', true))

    const fetched = [mail(2, '2026-10-16T12:00:00Z', false)]

    expect(visibleMails(fetched, state, {})).toBe(fetched)
    expect(visibleMails(fetched, state, { text: 'invoice' })).toBe(fetched)
  })
})

describe('visibleConversations', () => {
  it('keeps a retained conversation by key, ordered by its latest mail', () => {
    const state: RetainedConversations = new Map()
    const opened = conversation('id:opened@example.com', '2026-10-16T10:00:00Z')
    retainConversation(state, opened)

    const fetched = [conversation('a', '2026-10-16T12:00:00Z'), conversation('b', '2026-10-16T08:00:00Z')]
    const visible = visibleConversations(fetched, state, { unread: true })

    expect(visible.map(item => item.key)).toEqual(['a', 'id:opened@example.com', 'b'])
    expect(visible[1]!.unread).toBe(false)
  })

  it('hides a fetched read conversation that is not retained', () => {
    const fetched = [
      conversation('read', '2026-10-16T12:00:00Z', false),
      conversation('unread', '2026-10-16T10:00:00Z', true)
    ]

    expect(visibleConversations(fetched, new Map(), { unread: true }).map(item => item.key)).toEqual(['unread'])
  })

  it('shows a retained conversation even after it was marked read', () => {
    const state: RetainedConversations = new Map()
    const read = conversation('id:opened@example.com', '2026-10-16T10:00:00Z', false)
    retainConversation(state, read)

    expect(visibleConversations([], state, { unread: true })).toEqual([{ ...read, unread: false }])
    expect(visibleConversations([read], state, { unread: true })).toEqual([{ ...read, unread: false }])
  })

  it('keeps read conversations without the unread filter', () => {
    const state: RetainedConversations = new Map()
    retainConversation(state, conversation('id:opened@example.com', '2026-10-16T10:00:00Z'))

    const fetched = [conversation('read', '2026-10-16T12:00:00Z', false)]

    expect(visibleConversations(fetched, state, {})).toBe(fetched)
  })
})
