import { describe, expect, it } from 'vitest'
import type { MailDocumentUpdate, MailIndexQuery } from '../server/utils/mail-search-index'
import type { MailStreamHeader, MailSummary } from '../shared/types/mail'
import { mailDocumentId } from '../server/mail-index/document'
import { backfillMailboxStreamKeys, STREAM_HEADER_BATCH } from '../server/utils/mail-stream-backfill'

/** An in-memory stand-in for the search index, keyed by UID per mailbox */
function createIndex(documents: Map<number, string[]>) {
  const updates: MailDocumentUpdate[] = []

  const index = {
    async search(query: MailIndexQuery): Promise<MailSummary[]> {
      const all = [...documents.entries()].map(([uid, conversationKeys]) => ({ uid, mailbox: query.mailbox ?? '', conversationKeys })) as MailSummary[]
      const offset = query.offset ?? 0
      return all.slice(offset, offset + query.limit)
    },
    async updateDocuments(next: MailDocumentUpdate[]) {
      updates.push(...next)
      for (const update of next) {
        const uid = Number(update.id.split('-').at(-1))
        if (update.conversationKeys) {
          documents.set(uid, update.conversationKeys)
        }
      }
    }
  }

  return { index, updates }
}

const providerReturning = (headers: Map<number, MailStreamHeader>) => ({
  async getStreamHeaders(_mailbox: string, uids: number[]): Promise<MailStreamHeader[]> {
    return uids.map(uid => headers.get(uid) ?? { uid, from: [], bulk: false })
  }
})

describe('backfillMailboxStreamKeys', () => {
  const stored = () => new Map<number, string[]>([
    [1, ['subj:security-news@drupal.org:entity list', 'id:sa-1@drupal.org']],
    [2, ['subj:news@example.com:issue 12', 'id:n-2@example.com']],
    [3, ['subj:jane@example.com:lunch', 'id:p-3@example.com']],
    [4, ['id:root@example.com']]
  ])

  it('merges the list key into the stored keys and records the list id', async () => {
    const documents = stored()
    const { index, updates } = createIndex(documents)
    const headers = new Map<number, MailStreamHeader>([
      [1, { uid: 1, from: [{ address: 'security-news@drupal.org' }], listId: 'security-news.drupal.org', listName: 'Drupal Security News', bulk: true }]
    ])

    const result = await backfillMailboxStreamKeys({
      service: 'svc',
      mailbox: 'INBOX',
      uids: [1, 2, 3, 4],
      provider: providerReturning(headers),
      index
    })

    expect(result).toEqual({ updated: 1, complete: true })
    expect(updates).toEqual([{
      id: mailDocumentId('svc', 'INBOX', 1),
      conversationKeys: ['subj:security-news@drupal.org:entity list', 'id:sa-1@drupal.org', 'list:security-news.drupal.org'],
      listId: 'security-news.drupal.org',
      listName: 'Drupal Security News'
    }])
    // A personal mail gets no key and is left untouched
    expect(documents.get(3)).toEqual(['subj:jane@example.com:lunch', 'id:p-3@example.com'])
  })

  it('derives a from: key for bulk mail and keeps a reply root intact', async () => {
    const documents = stored()
    const { index, updates } = createIndex(documents)
    const headers = new Map<number, MailStreamHeader>([
      [2, { uid: 2, from: [{ address: 'news@example.com' }], bulk: true }],
      [4, { uid: 4, from: [{ address: 'security-news@drupal.org' }], listId: 'security-news.drupal.org', bulk: true }]
    ])

    await backfillMailboxStreamKeys({ service: 'svc', mailbox: 'INBOX', uids: [1, 2, 3, 4], provider: providerReturning(headers), index })

    expect(updates).toHaveLength(2)
    expect(documents.get(2)).toEqual(['subj:news@example.com:issue 12', 'id:n-2@example.com', 'from:news@example.com'])
    expect(documents.get(4)).toEqual(['id:root@example.com', 'list:security-news.drupal.org'])
  })

  it('is idempotent, so a resumed run does no work twice', async () => {
    const documents = stored()
    const first = createIndex(documents)
    const headers = new Map<number, MailStreamHeader>([
      [1, { uid: 1, from: [{ address: 'security-news@drupal.org' }], listId: 'security-news.drupal.org', bulk: true }]
    ])

    const args = { service: 'svc', mailbox: 'INBOX', uids: [1, 2, 3, 4], provider: providerReturning(headers) }
    await backfillMailboxStreamKeys({ ...args, index: first.index })

    const second = createIndex(documents)
    const result = await backfillMailboxStreamKeys({ ...args, index: second.index })

    expect(result.updated).toBe(0)
    expect(second.updates).toEqual([])
  })

  it('stops at a lost lock and asks to resume later', async () => {
    const documents = stored()
    const { index, updates } = createIndex(documents)
    const headers = new Map<number, MailStreamHeader>([
      [1, { uid: 1, from: [{ address: 'security-news@drupal.org' }], listId: 'security-news.drupal.org', bulk: true }]
    ])

    const result = await backfillMailboxStreamKeys({
      service: 'svc',
      mailbox: 'INBOX',
      uids: [1],
      provider: providerReturning(headers),
      index,
      renew: async () => false
    })

    expect(result).toEqual({ updated: 0, complete: false })
    expect(updates).toEqual([])
  })

  it('fetches within the configured batch size', async () => {
    const documents = new Map<number, string[]>()
    const total = STREAM_HEADER_BATCH * 2
    for (let uid = 1; uid <= total; uid++) {
      documents.set(uid, [`subj:a@b.com:issue ${uid}`, `id:${uid}@b.com`])
    }
    const { index } = createIndex(documents)
    const batches: number[] = []

    await backfillMailboxStreamKeys({
      service: 'svc',
      mailbox: 'INBOX',
      uids: [...documents.keys()],
      provider: {
        async getStreamHeaders(_mailbox, uids) {
          batches.push(uids.length)
          return uids.map(uid => ({ uid, from: [{ address: 'news@example.com' }], bulk: true }))
        }
      },
      index
    })

    expect(batches).toEqual([STREAM_HEADER_BATCH, STREAM_HEADER_BATCH])
  })

  // Timing only; the provider is mocked, so this is the merge and index cost,
  // not the IMAP round trips a real backfill pays
  it('measures the merge cost per 1000 mails', async () => {
    const total = 1000
    const documents = new Map<number, string[]>()
    for (let uid = 1; uid <= total; uid++) {
      documents.set(uid, [`subj:news@example.com:issue ${uid}`, `id:${uid}@example.com`])
    }
    const { index } = createIndex(documents)

    const started = performance.now()
    const result = await backfillMailboxStreamKeys({
      service: 'svc',
      mailbox: 'INBOX',
      uids: [...documents.keys()],
      provider: {
        async getStreamHeaders(_mailbox, uids) {
          return uids.map(uid => ({ uid, from: [{ address: 'news@example.com' }], bulk: true }))
        }
      },
      index
    })
    const elapsed = performance.now() - started

    expect(result.updated).toBe(total)
    // The timing is the point of this test; the mocked provider has no latency
    console.log(`[backfill] ${total} mails in ${elapsed.toFixed(1)} ms`)
  })
})
