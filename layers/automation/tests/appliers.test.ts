import { describe, expect, it, vi } from 'vitest'
import { createDocumentsApplier, createMailApplier, labelMailbox, toMailActionProvider } from '../server/utils/appliers'
import type { DocumentsActionProvider, MailActionProvider } from '../server/utils/appliers'
import type { MailProvider } from '../../mail/server/utils/mail-provider'
import type { AutomationItem } from '../shared/types/automation'

function mailItem(overrides: Partial<AutomationItem> = {}): AutomationItem {
  return {
    domain: 'mail',
    service: 'mail-1',
    key: 'INBOX|1|m1',
    mailbox: 'INBOX',
    uid: 1,
    unread: true,
    flagged: false,
    fields: {},
    state: '',
    title: 'Invoice',
    ...overrides
  }
}

function documentItem(): AutomationItem {
  return { domain: 'documents', service: 'doc-1', key: '7', documentId: 7, fields: {}, state: '', title: 'Invoice' }
}

interface FakeMailProvider extends MailActionProvider {
  calls: Array<[string, ...unknown[]]>
}

function mailProvider(): FakeMailProvider {
  const calls: Array<[string, ...unknown[]]> = []
  return {
    calls,
    async moveMessage(mailbox, uid, target) {
      calls.push(['moveMessage', mailbox, uid, target])
      return { uid: uid + 100 }
    },
    async addLabel(mailbox, uid, label) {
      calls.push(['addLabel', mailbox, uid, label])
      return { uid: uid + 200 }
    },
    async setSeen(mailbox, uid, seen) {
      calls.push(['setSeen', mailbox, uid, seen])
    },
    async setFlagged(mailbox, uid, flagged) {
      calls.push(['setFlagged', mailbox, uid, flagged])
    },
    async deleteMessage(mailbox, uid) {
      calls.push(['deleteMessage', mailbox, uid])
    },
    async listMailboxes() {
      return [
        { path: 'INBOX', name: 'Inbox', total: 0, unread: 0 },
        { path: 'Trash', name: 'Trash', total: 0, unread: 0, specialUse: '\\Trash' }
      ]
    }
  }
}

describe('createMailApplier', () => {
  it('moves, then labels the same message using its new uid', async () => {
    const provider = mailProvider()
    const publish = vi.fn()
    const applier = createMailApplier({ provider, publish })

    const { applied, item } = await applier.apply([
      { type: 'move-to', folder: 'Archive' },
      { type: 'label', label: 'Invoices' }
    ], mailItem())

    expect(provider.calls).toEqual([
      ['moveMessage', 'INBOX', 1, 'Archive'],
      ['addLabel', 'Archive', 101, 'Invoices']
    ])
    expect(item.mailbox).toBe('Archive')
    expect(item.uid).toBe(101)
    expect(applied).toEqual([
      { type: 'move-to', folder: 'Archive', from: 'INBOX', uid: 101 },
      { type: 'label', label: 'Invoices', labelMailbox: labelMailbox('Invoices'), uid: 301 }
    ])
    expect(publish).toHaveBeenCalledWith('Labels/Invoices')
  })

  it('marks read and stars only when it changes something', async () => {
    const provider = mailProvider()
    const applier = createMailApplier({ provider, publish: vi.fn() })

    const { applied } = await applier.apply([
      { type: 'mark-read' },
      { type: 'star' },
      { type: 'star' }
    ], mailItem({ unread: false, flagged: true }))

    // Already read and already flagged: nothing to record, nothing to undo
    expect(applied).toEqual([])
    expect(provider.calls).toEqual([])
  })

  it('creates the label folder before filing a copy when the provider supports it', async () => {
    const provider = mailProvider()
    const created: string[] = []
    provider.createMailbox = async (mailbox) => {
      created.push(mailbox)
    }
    const applier = createMailApplier({ provider, publish: vi.fn() })

    await applier.apply([{ type: 'label', label: 'Invoices' }], mailItem())

    expect(created).toEqual(['Labels/Invoices'])
    expect(provider.calls).toEqual([['addLabel', 'INBOX', 1, 'Invoices']])
  })

  it('reverses a move and a label copy', async () => {
    const provider = mailProvider()
    const applier = createMailApplier({ provider, publish: vi.fn() })

    await applier.undo([
      { op: 'move', mailbox: 'Archive', uid: 101, target: 'INBOX' },
      { op: 'delete', mailbox: 'Labels/Invoices', uid: 301 }
    ])

    expect(provider.calls).toEqual([
      ['moveMessage', 'Archive', 101, 'INBOX'],
      ['deleteMessage', 'Labels/Invoices', 301]
    ])
  })

  it('refuses a document action on a mail item', async () => {
    const applier = createMailApplier({ provider: mailProvider(), publish: vi.fn() })
    await expect(applier.apply([{ type: 'add-tag', tag: 1 }], mailItem())).rejects.toThrow('not a mail action')
  })

  it('refuses a generic action on a mail item', async () => {
    const applier = createMailApplier({ provider: mailProvider(), publish: vi.fn() })
    await expect(applier.apply([{ type: 'notify', title: 'Hi' }], mailItem())).rejects.toThrow('not a mail action')
  })

  it('refuses to trash a mail that already sits in the trash', async () => {
    const provider = mailProvider()
    const applier = createMailApplier({ provider, publish: vi.fn() })

    await expect(applier.apply([{ type: 'trash' }], mailItem({ mailbox: 'Trash' }))).rejects.toThrow('cannot be moved to the trash')
    expect(provider.calls).toEqual([])
  })

  it('refuses to trash when the account has no trash folder', async () => {
    const provider = mailProvider()
    provider.listMailboxes = async () => [{ path: 'INBOX', name: 'Inbox', total: 0, unread: 0 }]
    const applier = createMailApplier({ provider, publish: vi.fn() })

    await expect(applier.apply([{ type: 'trash' }], mailItem())).rejects.toThrow('cannot be moved to the trash')
  })
})

describe('toMailActionProvider', () => {
  it('carries the optional createMailbox through to the applier port', async () => {
    const created: string[] = []
    const provider = Object.assign(mailProvider(), {
      createMailbox: async (mailbox: string) => {
        created.push(mailbox)
      }
    }) as unknown as MailProvider

    const port = toMailActionProvider(provider)
    await port.createMailbox?.('Labels/Invoices')

    expect(created).toEqual(['Labels/Invoices'])
  })

  it('omits createMailbox when the provider cannot create folders', () => {
    const port = toMailActionProvider(mailProvider() as unknown as MailProvider)
    expect(port.createMailbox).toBeUndefined()
  })
})

interface FakeDocumentsProvider extends DocumentsActionProvider {
  state: { tags: number[], correspondent: number | null, documentType: number | null }
  updates: Array<{ tags?: number[], correspondent?: number | null, documentType?: number | null }>
}

function documentsProvider(): FakeDocumentsProvider {
  const state = { tags: [1, 2], correspondent: 5, documentType: 3 }
  const updates: FakeDocumentsProvider['updates'] = []
  return {
    state,
    updates,
    async get() {
      return { id: 7, ...state }
    },
    async update(_id, patch) {
      updates.push(patch)
      Object.assign(state, patch)
    }
  }
}

describe('createDocumentsApplier', () => {
  it('adds a tag, sets the correspondent and the type, capturing the previous values', async () => {
    const provider = documentsProvider()
    const publish = vi.fn()
    const applier = createDocumentsApplier({ provider, publish })

    const { applied } = await applier.apply([
      { type: 'add-tag', tag: 9 },
      { type: 'set-correspondent', correspondent: 8 },
      { type: 'set-type', documentType: 4 }
    ], documentItem())

    expect(applied).toEqual([
      { type: 'add-tag', document: 7, tag: 9, previousTags: [1, 2] },
      { type: 'set-correspondent', document: 7, correspondent: 8, previous: 5 },
      { type: 'set-type', document: 7, documentType: 4, previous: 3 }
    ])
    expect(publish).toHaveBeenCalled()
  })

  it('skips an action whose value is already set', async () => {
    const provider = documentsProvider()
    const applier = createDocumentsApplier({ provider, publish: vi.fn() })

    const { applied } = await applier.apply([
      { type: 'add-tag', tag: 2 },
      { type: 'set-correspondent', correspondent: 5 }
    ], documentItem())

    expect(applied).toEqual([])
    expect(provider.updates).toEqual([])
  })

  it('restores metadata on undo', async () => {
    const provider = documentsProvider()
    const applier = createDocumentsApplier({ provider, publish: vi.fn() })

    await applier.undo([
      { op: 'set-tags', document: 7, tags: [1, 2] },
      { op: 'set-correspondent', document: 7, correspondent: null },
      { op: 'set-document-type', document: 7, documentType: 2 }
    ])

    expect(provider.updates).toEqual([
      { tags: [1, 2] },
      { correspondent: null },
      { documentType: 2 }
    ])
  })
})
