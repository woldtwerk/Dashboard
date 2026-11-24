import { afterEach, describe, expect, it, vi } from 'vitest'
import { isMailAfter, loadMailItems, loadMailSince, mailItemKey } from '../server/utils/automation-items'
import type { MailMessage, MailSummary } from '../../mail/shared/types/mail'

const INBOX = 'INBOX'

function summary(uid: number, messageId: string): MailSummary {
  return {
    uid,
    mailbox: INBOX,
    messageId,
    subject: `Mail ${uid}`,
    from: [{ address: 'sender@example.com' }],
    date: `2026-10-18T09:0${uid}:00.000Z`,
    unread: true,
    flagged: false
  }
}

function message(uid: number, messageId: string): MailMessage {
  return { ...summary(uid, messageId), to: [], cc: [], text: `Body ${uid}` }
}

/** A provider whose listing returns three mails; only what `getMessages` is asked for comes back */
function provider(summaries: MailSummary[]) {
  const byUid = new Map(summaries.map(entry => [entry.uid, message(entry.uid, entry.messageId!)]))

  return {
    listMessages: vi.fn(async () => summaries),
    getMessages: vi.fn(async (_mailbox: string, uids: number[]) => uids.flatMap(uid => byUid.get(uid) ?? [])),
    getMessage: vi.fn(async (_mailbox: string, uid: number) => byUid.get(uid) ?? null)
  }
}

describe('loadMailItems', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fetches only the due bodies, in one batch and never one message at a time', async () => {
    const summaries = [summary(1, '<a@example.com>'), summary(2, '<b@example.com>'), summary(3, '<c@example.com>')]
    const mail = provider(summaries)
    vi.stubGlobal('useMailSearchIndex', () => undefined)
    vi.stubGlobal('useMailProvider', async () => mail)

    const dueKey = mailItemKey(INBOX, 2, '<b@example.com>')
    const isDue = vi.fn(async (keys: string[]) => new Set(keys.filter(key => key === dueKey)))

    const items = await loadMailItems('mail-1', 500, isDue)

    expect(isDue).toHaveBeenCalledWith(summaries.map(entry => mailItemKey(INBOX, entry.uid, entry.messageId)))
    expect(mail.getMessages).toHaveBeenCalledOnce()
    expect(mail.getMessages).toHaveBeenCalledWith(INBOX, [2])
    expect(mail.getMessage).not.toHaveBeenCalled()
    expect(items.map(item => item.key)).toEqual([dueKey])
  })

  it('downloads no body at all when nothing is due', async () => {
    const mail = provider([summary(1, '<a@example.com>'), summary(2, '<b@example.com>')])
    vi.stubGlobal('useMailSearchIndex', () => undefined)
    vi.stubGlobal('useMailProvider', async () => mail)

    const items = await loadMailItems('mail-1', 500, async () => new Set())

    expect(mail.listMessages).toHaveBeenCalledOnce()
    expect(mail.getMessages).not.toHaveBeenCalled()
    expect(items).toEqual([])
  })

  it('drops mail from before the activation, before any body is fetched', async () => {
    const mail = provider([summary(1, '<a@example.com>'), summary(2, '<b@example.com>')])
    vi.stubGlobal('useMailSearchIndex', () => undefined)
    vi.stubGlobal('useMailProvider', async () => mail)

    const items = await loadMailItems('mail-1', 500, undefined, INBOX, '2026-10-18T09:01:30.000Z')

    expect(mail.getMessages).toHaveBeenCalledOnce()
    expect(mail.getMessages).toHaveBeenCalledWith(INBOX, [2])
    expect(items.map(item => item.key)).toEqual([mailItemKey(INBOX, 2, '<b@example.com>')])
  })
})

describe('isMailAfter', () => {
  const since = '2026-10-18T09:00:00.000Z'

  it.each([
    ['newer', '2026-10-18T09:00:01.000Z', since, true],
    ['equal', since, since, false],
    ['older', '2026-10-18T08:59:59.000Z', since, false],
    ['unparseable', 'not a date', since, false],
    ['without a watermark', '2026-10-18T08:00:00.000Z', null, true]
  ])('counts %s mail as new only when it is after the watermark', (_name, date, from, expected) => {
    expect(isMailAfter(date as string, from as string | null)).toBe(expected)
  })
})

describe('loadMailSince', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fetches no body for mail at or before the cursor and never moves the cursor back', async () => {
    const mail = provider([summary(1, '<a@example.com>')])
    vi.stubGlobal('useMailSearchIndex', () => undefined)
    vi.stubGlobal('useMailProvider', async () => mail)

    const since = '2026-10-18T09:05:00.000Z'
    const result = await loadMailSince('mail-1', since, 500)

    expect(mail.getMessages).not.toHaveBeenCalled()
    expect(result.items).toEqual([])
    expect(result.cursor).toBe(since)
  })

  it('loads the mail after the cursor and advances the cursor to the newest of it', async () => {
    const mail = provider([summary(1, '<a@example.com>'), summary(2, '<b@example.com>')])
    vi.stubGlobal('useMailSearchIndex', () => undefined)
    vi.stubGlobal('useMailProvider', async () => mail)

    const result = await loadMailSince('mail-1', '2026-10-18T09:01:30.000Z', 500)

    expect(mail.getMessages).toHaveBeenCalledWith(INBOX, [2])
    expect(result.items.map(item => item.key)).toEqual([mailItemKey(INBOX, 2, '<b@example.com>')])
    expect(result.cursor).toBe('2026-10-18T09:02:00.000Z')
  })
})
