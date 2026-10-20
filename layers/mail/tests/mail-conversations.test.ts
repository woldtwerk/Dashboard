import { describe, expect, it } from 'vitest'
import type { MailSummary } from '../shared/types/mail'
import { loadConversationPage } from '../server/utils/mail-conversations'

const mail = (key: string, date: string, uid: number): MailSummary => ({
  uid,
  mailbox: 'INBOX',
  subject: key,
  from: [{ address: `${key}@example.com` }],
  date,
  unread: false,
  flagged: false,
  conversationKeys: [`id:${key}`]
})

/** A chunk fetcher over a fixed, newest-first list that records its requests */
function chunks(mails: MailSummary[]) {
  const requests: { offset: number, size: number }[] = []
  const fetchChunk = async (offset: number, size: number) => {
    requests.push({ offset, size })
    return mails.slice(offset, offset + size)
  }
  return { fetchChunk, requests }
}

describe('loadConversationPage', () => {
  it('groups a conversation that spans a chunk border and fills the page', async () => {
    const source = chunks([
      mail('A', '2026-10-10T10:00:00.000Z', 1),
      mail('B', '2026-10-09T10:00:00.000Z', 2),
      mail('A', '2026-10-08T10:00:00.000Z', 3),
      mail('C', '2026-10-07T10:00:00.000Z', 4),
      mail('D', '2026-10-06T10:00:00.000Z', 5)
    ])

    const page = await loadConversationPage(source.fetchChunk, 0, 3, { chunkSize: 2 })

    expect(page.map(conversation => conversation.key)).toEqual(['id:A', 'id:B', 'id:C'])
    expect(page[0]!.count).toBe(2)
    expect(source.requests).toEqual([{ offset: 0, size: 2 }, { offset: 2, size: 2 }, { offset: 4, size: 2 }])
  })

  it('returns the rest of a deep page', async () => {
    const source = chunks([
      mail('A', '2026-10-10T10:00:00.000Z', 1),
      mail('B', '2026-10-09T10:00:00.000Z', 2),
      mail('C', '2026-10-08T10:00:00.000Z', 3),
      mail('D', '2026-10-07T10:00:00.000Z', 4),
      mail('E', '2026-10-06T10:00:00.000Z', 5)
    ])

    const page = await loadConversationPage(source.fetchChunk, 2, 2, { chunkSize: 3 })

    expect(page.map(conversation => conversation.key)).toEqual(['id:C', 'id:D'])
  })

  it('stops as soon as the index is exhausted', async () => {
    const source = chunks([
      mail('A', '2026-10-10T10:00:00.000Z', 1),
      mail('B', '2026-10-09T10:00:00.000Z', 2),
      mail('C', '2026-10-08T10:00:00.000Z', 3)
    ])

    const page = await loadConversationPage(source.fetchChunk, 0, 5, { chunkSize: 2 })

    expect(page.map(conversation => conversation.key)).toEqual(['id:A', 'id:B', 'id:C'])
    expect(source.requests).toEqual([{ offset: 0, size: 2 }, { offset: 2, size: 2 }])
  })

  it('never scans past the cap', async () => {
    const source = chunks(Array.from({ length: 20 }, (_, index) =>
      mail(String.fromCharCode(65 + index), `2026-10-${String(20 - index).padStart(2, '0')}T10:00:00.000Z`, index + 1)
    ))

    const page = await loadConversationPage(source.fetchChunk, 0, 10, { chunkSize: 4, maxMails: 10 })

    expect(page).toHaveLength(10)
    expect(source.requests).toEqual([{ offset: 0, size: 4 }, { offset: 4, size: 4 }, { offset: 8, size: 2 }])
    expect(source.requests.reduce((sum, request) => sum + request.size, 0)).toBe(10)
  })
})
