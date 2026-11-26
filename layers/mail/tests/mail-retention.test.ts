import { describe, expect, it } from 'vitest'
import type { MailConversation, MailSearch, MailSummary } from '../shared/types/mail'
import { mailKey } from '../app/utils/mail'
import { retain, retainConversation, retainedAfterSeen, visibleConversations, visibleMails, type RetainedConversations, type RetainedMails } from '../app/utils/mail-retention'

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
  it('stores the mail shown as read', () => {
    const state: RetainedMails = new Map()
    retain(state, mail(7, '2026-10-16T10:00:00Z', true))

    expect([...state.values()]).toEqual([{ ...mail(7, '2026-10-16T10:00:00Z'), unread: false }])
  })

  it('stores the conversation and its latest mail as read', () => {
    const state: RetainedConversations = new Map()
    const opened = conversation('id:opened@example.com', '2026-10-16T10:00:00Z')
    retainConversation(state, opened)

    expect(state.get(opened.key)).toEqual({ ...opened, unread: false, latest: { ...opened.latest, unread: false } })
  })
})

describe('retainedAfterSeen', () => {
  const date = '2026-10-16T10:00:00Z'

  it('keeps a mail still in the loaded list as read', () => {
    const unread = mail(1, date, true)
    const next = retainedAfterSeen(new Map(), [unread], [unread], true)

    expect(next.get(mailKey(unread))).toEqual({ ...unread, unread: false })
  })

  it('keeps a read mail the list already dropped as read', () => {
    const read = mail(2, date)
    const state: RetainedMails = new Map([[mailKey(read), read]])
    const next = retainedAfterSeen(state, [read], [], true)

    expect(next.get(mailKey(read))).toEqual({ ...read, unread: false })
  })

  it('keeps a row the list dropped when it is marked unread again', () => {
    const read = mail(3, date)
    const state: RetainedMails = new Map([[mailKey(read), read]])
    const next = retainedAfterSeen(state, [read], [], false)

    expect(next.get(mailKey(read))).toEqual({ ...read, unread: true })
  })

  it('does not add a mail that was never in the list', () => {
    const linked = mail(4, date, true)
    const state: RetainedMails = new Map()

    expect(retainedAfterSeen(state, [linked], [], true)).toEqual(state)
    expect(state.size).toBe(0)
  })

  it('adds no entry for a mail still in the list that is marked unread', () => {
    const unread = mail(5, date, true)

    expect(retainedAfterSeen(new Map(), [unread], [unread], false).size).toBe(0)
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

  it('shows a retained mail that was marked unread as unread', () => {
    const unread = mail(6, '2026-10-16T10:00:00Z', true)
    const state: RetainedMails = new Map([[mailKey(unread), unread]])

    expect(visibleMails([], state, { unread: true })).toEqual([unread])
  })

  const pruned: [string, MailSearch, MailSummary][] = [
    ['label', { label: 'Done' }, { ...mail(7, '2026-10-16T10:00:00Z'), labels: ['Other'] }],
    ['notLabel', { notLabel: 'Done' }, { ...mail(8, '2026-10-16T10:00:00Z'), labels: ['Done'] }]
  ]
  it.each(pruned)('does not splice a retained mail that fails %s', (_name, filter, held) => {
    const state: RetainedMails = new Map([[mailKey(held), held]])

    expect(visibleMails([], state, { unread: true, ...filter })).toEqual([])
  })

  it('splices a retained mail that still matches the label filter', () => {
    const labelled = { ...mail(9, '2026-10-16T10:00:00Z'), labels: ['Done'] }
    const state: RetainedMails = new Map([[mailKey(labelled), labelled]])

    expect(visibleMails([], state, { unread: true, label: 'Done' })).toEqual([labelled])
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

  it('shows a retained conversation with the same latest mail as read', () => {
    const state: RetainedConversations = new Map()
    const opened = conversation('id:opened@example.com', '2026-10-16T10:00:00Z')
    retainConversation(state, opened)

    const fetched = [{ ...opened, unread: true }]
    const visible = visibleConversations(fetched, state, { unread: true })

    expect(visible).toEqual([{ ...opened, unread: false, latest: { ...opened.latest, unread: false } }])
  })

  it.each([
    ['a new uid', mail(2, '2026-10-16T10:00:00Z', true)],
    ['a new date', mail(1, '2026-10-16T11:00:00Z', true)]
  ])('shows a retained conversation with %s in its latest mail as unread again', (_label, latest) => {
    const state: RetainedConversations = new Map()
    const opened = conversation('id:opened@example.com', '2026-10-16T10:00:00Z')
    retainConversation(state, opened)

    const fresh = { ...opened, unread: true, latest }
    const visible = visibleConversations([fresh], state, { unread: true })

    expect(visible).toEqual([fresh])
    expect(visible[0]!.unread).toBe(true)
  })

  it('does not splice a retained conversation whose latest carries the excluded label', () => {
    const state: RetainedConversations = new Map()
    const opened = conversation('id:opened@example.com', '2026-10-16T10:00:00Z')
    retainConversation(state, { ...opened, latest: { ...opened.latest, labels: ['Done'] } })

    expect(visibleConversations([], state, { unread: true, notLabel: 'Done' })).toEqual([])
  })

  it('keeps read conversations without the unread filter', () => {
    const state: RetainedConversations = new Map()
    retainConversation(state, conversation('id:opened@example.com', '2026-10-16T10:00:00Z'))

    const fetched = [conversation('read', '2026-10-16T12:00:00Z', false)]

    expect(visibleConversations(fetched, state, {})).toBe(fetched)
  })
})
