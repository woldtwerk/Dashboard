import { describe, expect, it, vi } from 'vitest'
import type { MailDocument } from '../server/mail-index/document'
import { mailDocumentId } from '../server/mail-index/document'
import { setMailLabelMany, type MailLabelDependencies } from '../server/utils/mail-labels'

const document = (mailbox: string, uid: number, messageId: string, labels: string[] = []): MailDocument => ({
  id: mailDocumentId('svc', mailbox, uid),
  service: 'svc',
  mailbox,
  uid,
  messageId,
  conversationKeys: [],
  subject: 'Mail',
  fromText: '',
  fromTerms: [],
  fromList: [],
  toList: [],
  ccList: [],
  participantTerms: [],
  toText: '',
  date: 0,
  unread: false,
  flagged: false,
  hasAttachment: false,
  labels,
  text: ''
})

function dependencies(overrides: Partial<MailLabelDependencies> = {}) {
  const calls: string[] = []
  const provider = {
    addLabels: vi.fn(async () => {
      calls.push('addLabels')
      return new Map<number, number>()
    }),
    removeLabels: vi.fn(async () => {
      calls.push('removeLabels')
      return { removed: [300], unresolved: [] }
    })
  }
  const index = {
    getDocuments: vi.fn(async () => {
      calls.push('getDocuments')
      return [document('INBOX', 7, '<a@example.com>', ['Invoices'])]
    }),
    documentsByMessageIds: vi.fn(async () => {
      calls.push('documentsByMessageIds')
      return [
        document('INBOX', 7, '<a@example.com>', ['Invoices']),
        document('Labels/Done', 300, '<a@example.com>', ['Done'])
      ]
    }),
    updateDocuments: vi.fn(async () => {
      calls.push('updateDocuments')
    }),
    remove: vi.fn(async () => {
      calls.push('remove')
    })
  }

  const deps: MailLabelDependencies = {
    provider,
    index,
    publish: async (mailbox) => {
      calls.push(`publish:${mailbox}`)
    },
    logger: { warn: vi.fn() },
    ...overrides
  }

  return { calls, provider, index, deps }
}

describe('setMailLabelMany', () => {
  it('does nothing for an empty uid list', async () => {
    const { deps, provider, index, calls } = dependencies()

    await setMailLabelMany('svc', 'INBOX', [], 'Done', true, deps)

    expect(provider.addLabels).not.toHaveBeenCalled()
    expect(index.getDocuments).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('adds the label, updates every copy in the index and announces both folders', async () => {
    const { deps, provider, index, calls } = dependencies()

    await setMailLabelMany('svc', 'INBOX', [7], 'Done', true, deps)

    expect(calls).toEqual([
      'addLabels',
      'getDocuments',
      'documentsByMessageIds',
      'updateDocuments',
      'publish:INBOX',
      'publish:Labels/Done'
    ])
    expect(provider.addLabels).toHaveBeenCalledWith('INBOX', [7], 'Done')
    expect(index.getDocuments).toHaveBeenCalledWith([mailDocumentId('svc', 'INBOX', 7)])
    expect(index.documentsByMessageIds).toHaveBeenCalledWith('svc', ['<a@example.com>'])
    expect(index.updateDocuments).toHaveBeenCalledWith([
      { id: mailDocumentId('svc', 'INBOX', 7), labels: ['Invoices', 'Done'] },
      { id: mailDocumentId('svc', 'Labels/Done', 300), labels: ['Done'] }
    ])
  })

  it('removes the label copies from the index too', async () => {
    const { deps, index } = dependencies()
    // The label copy is gone once the index re-reads the message
    index.documentsByMessageIds.mockResolvedValueOnce([
      document('INBOX', 7, '<a@example.com>', ['Invoices', 'Done'])
    ])

    await setMailLabelMany('svc', 'INBOX', [7], 'Done', false, deps)

    expect(deps.provider.removeLabels).toHaveBeenCalledWith('INBOX', [7], 'Done')
    expect(index.remove).toHaveBeenCalledWith([mailDocumentId('svc', 'Labels/Done', 300)])
    expect(index.updateDocuments).toHaveBeenCalledWith([
      { id: mailDocumentId('svc', 'INBOX', 7), labels: ['Invoices'] }
    ])
  })

  it('drops the label only for the messages that were resolved', async () => {
    const { deps, index } = dependencies()
    deps.provider.removeLabels = vi.fn(async () => ({ removed: [300], unresolved: [9] }))
    index.getDocuments.mockResolvedValueOnce([document('INBOX', 7, '<a@example.com>', ['Done'])])
    index.documentsByMessageIds.mockResolvedValueOnce([document('INBOX', 7, '<a@example.com>', ['Done'])])

    await expect(setMailLabelMany('svc', 'INBOX', [7, 9], 'Done', false, deps)).resolves.toEqual({ unresolved: [9] })

    expect(index.getDocuments).toHaveBeenCalledWith([mailDocumentId('svc', 'INBOX', 7)])
    expect(index.updateDocuments).toHaveBeenCalledWith([
      { id: mailDocumentId('svc', 'INBOX', 7), labels: [] }
    ])
  })

  it('logs an index failure and still announces the change', async () => {
    const { deps, calls } = dependencies()
    deps.index!.getDocuments = vi.fn(async () => {
      throw new Error('meilisearch down')
    })

    await expect(setMailLabelMany('svc', 'INBOX', [7], 'Done', true, deps)).resolves.toEqual({ unresolved: [] })

    expect(deps.logger.warn).toHaveBeenCalledOnce()
    expect(vi.mocked(deps.logger.warn).mock.calls[0]?.[1]).toMatchObject({ error: 'meilisearch down' })
    expect(calls).toContain('publish:INBOX')
    expect(calls).toContain('publish:Labels/Done')
  })

  it('works without a search index', async () => {
    const { deps } = dependencies()
    delete deps.index

    await expect(setMailLabelMany('svc', 'INBOX', [7], 'Done', true, deps)).resolves.toEqual({ unresolved: [] })

    expect(deps.provider.addLabels).toHaveBeenCalledOnce()
  })
})
