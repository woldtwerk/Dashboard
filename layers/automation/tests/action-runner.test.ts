import { describe, expect, it } from 'vitest'
import { extractValue, runActions } from '../server/utils/action-runner'
import type { ActionRunContext, DriveFileHistory, DriveSavePort } from '../server/utils/action-runner'
import type { AutomationApplier } from '../server/utils/engine'
import type { MailAttachment } from '../../mail/shared/types/mail'
import { sha256Hex } from '../../drive/shared/drive-upload'
import type { AppliedAction, AutomationItem, PlannedAction, UndoOperation } from '../shared/types/automation'

function mailItem(overrides: Partial<AutomationItem> = {}): AutomationItem {
  return {
    domain: 'mail',
    service: 'mail-1',
    key: 'INBOX|1|m1',
    mailbox: 'INBOX',
    uid: 1,
    unread: true,
    flagged: false,
    fields: { from: 'GitHub <noreply@github.com>', subject: 'Your login code', text: 'Your verification code is 482913' },
    state: 'state',
    title: 'Your login code',
    ...overrides
  }
}

function planned(actions: Array<PlannedAction['action']>, ids?: string[]): PlannedAction[] {
  return actions.map((action, index) => ({ nodeId: ids?.[index] ?? `node-${index}`, action }))
}

/** An applier that records each call and moves the uid on, like a real mail move */
function fakeApplier(): AutomationApplier & { calls: Array<{ actions: string[], item: AutomationItem }> } {
  const calls: Array<{ actions: string[], item: AutomationItem }> = []
  return {
    calls,
    async apply(actions, item) {
      calls.push({ actions: actions.map(action => action.type), item })
      const applied: AppliedAction[] = actions.map(action => action.type === 'move-to'
        ? { type: 'move-to', folder: action.folder, from: item.mailbox!, uid: (item.uid ?? 0) + 100 }
        : { type: 'star', mailbox: item.mailbox!, uid: item.uid ?? 0, wasFlagged: false })
      return { applied, item: { ...item, uid: (item.uid ?? 0) + 100 } }
    },
    async undo(_operations: UndoOperation[]) {}
  }
}

describe('extractValue', () => {
  it('reads a login code from the body by default', () => {
    expect(extractValue({ type: 'extract', variable: 'code', extractor: 'login-code' }, mailItem())).toBe('482913')
  })

  it('can read from the subject', () => {
    const item = mailItem({ fields: { subject: 'Your code is ABC-123', text: '' } })
    expect(extractValue({ type: 'extract', variable: 'code', extractor: 'login-code', source: 'subject' }, item)).toBe('ABC123')
  })

  it('uses a regex pattern', () => {
    expect(extractValue({ type: 'extract', variable: 'order', extractor: 'regex', pattern: 'order (\\d+)' }, mailItem({ fields: { text: 'Your ORDER 4711 shipped' } }))).toBe('4711')
  })
})

describe('runActions', () => {
  it('extracts a variable and renders it into a notification and its modal', async () => {
    const now = new Date('2026-10-19T12:00:00.000Z')
    const { applied, variables } = await runActions(planned([
      { type: 'extract', variable: 'code', extractor: 'login-code' },
      {
        type: 'notify',
        title: 'Login code from {{from}}',
        body: '{{subject}} — {{code}}',
        modal: { title: 'Login code', text: '{{code}}', copy: true, expiresInMinutes: 15 }
      }
    ]), mailItem(), fakeApplier(), { workflow: 'Login codes', now: () => now })

    expect(variables).toEqual({ code: '482913' })
    expect(applied).toEqual([
      { type: 'extract', variable: 'code', value: '482913' },
      {
        type: 'notify',
        nodeId: 'node-1',
        title: 'Login code from GitHub <noreply@github.com>',
        body: 'Your login code — 482913',
        modal: {
          title: 'Login code',
          text: '482913',
          copy: true,
          expiresAt: '2026-10-19T12:15:00.000Z'
        }
      }
    ])
  })

  it('renders built-in variables and turns unknown ones into an empty string', async () => {
    const { applied } = await runActions(planned([
      { type: 'notify', title: '{{workflow}}: {{title}}', body: '{{nope}}' }
    ]), mailItem(), fakeApplier(), { workflow: 'Invoices' })

    expect(applied[0]).toMatchObject({ title: 'Invoices: Your login code', body: '' })
  })

  it('hands each domain action to the applier one at a time and carries the item forward', async () => {
    const applier = fakeApplier()
    const { applied, item } = await runActions(planned([
      { type: 'move-to', folder: 'Archive' },
      { type: 'star' }
    ]), mailItem(), applier)

    expect(applier.calls.map(call => call.actions)).toEqual([['move-to'], ['star']])
    expect(applier.calls[1]!.item.uid).toBe(101)
    expect(item.uid).toBe(201)
    expect(applied.map(action => action.type)).toEqual(['move-to', 'star'])
  })

  it('stops at a failed extract, so a following trash never runs', async () => {
    const applier = fakeApplier()

    await expect(runActions(planned([
      { type: 'extract', variable: 'code', extractor: 'login-code' },
      { type: 'trash' }
    ]), mailItem({ fields: { text: 'Your invoice 123456789012 is attached.' } }), applier))
      .rejects.toThrow('No code found')

    expect(applier.calls).toEqual([])
  })
})

// --- Save to drive --------------------------------------------------------

const encoder = new TextEncoder()

function attachment(filename: string, contentType: string, body: string): MailAttachment & { content: Uint8Array } {
  return { filename, contentType, size: encoder.encode(body).byteLength, content: encoder.encode(body) }
}

function fakeDrive(initial: Array<{ name: string, size: number }> = []) {
  const entries: Array<{ name: string, type: 'file' | 'folder', size?: number }> = initial.map(entry => ({ ...entry, type: 'file' }))
  const ensured: string[] = []
  const listed: string[] = []
  const uploaded: Array<{ folder: string, name: string, contentType: string }> = []

  const drive: DriveSavePort = {
    async ensureFolder(_service, path) {
      ensured.push(path)
    },
    async list(_service, path) {
      listed.push(path)
      return entries.map(entry => ({ ...entry }))
    },
    async upload(_service, folder, file) {
      uploaded.push({ folder, name: file.name, contentType: file.contentType })
      entries.push({ name: file.name, type: 'file', size: file.content.byteLength })
    }
  }

  return { drive, ensured, listed, uploaded }
}

/** The content records, keyed like the database's unique index */
function fakeHistory(preloaded: Array<{ service: string, folder: string, sha256: string, path: string, size: number }> = []) {
  const rows = new Map(preloaded.map(row => [`${row.service}:${row.folder}:${row.sha256}`, row]))
  const recorded: Array<{ service: string, folder: string, sha256: string, path: string, size: number }> = []

  const history: DriveFileHistory = {
    async has(service, folder, sha256) {
      return rows.has(`${service}:${folder}:${sha256}`)
    },
    async record(file) {
      const key = `${file.service}:${file.folder}:${file.sha256}`
      const exists = rows.has(key)
      if (!exists) {
        rows.set(key, file)
        recorded.push(file)
      }
      return !exists
    }
  }

  return { history, rows, recorded }
}

function saveContext(
  files: Array<MailAttachment & { content: Uint8Array }>,
  drive: DriveSavePort,
  history: DriveFileHistory = fakeHistory().history
): ActionRunContext {
  return { itemFiles: async () => files, drive, driveHistory: history }
}

describe('runActions: save-to-drive', () => {
  it('saves the matching attachments, creating the folder and recording the paths', async () => {
    const { drive, ensured, uploaded } = fakeDrive()
    const files = [
      attachment('clip.mp4', 'video/mp4', 'video'),
      attachment('invoice.pdf', 'application/pdf', 'pdf'),
      attachment('photo.jpg', 'image/jpeg', 'image')
    ]

    const { applied } = await runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public/salsa', accept: ['video/*'] }
    ]), mailItem(), fakeApplier(), saveContext(files, drive))

    expect(ensured).toEqual(['/my-files/Public/salsa'])
    expect(uploaded).toEqual([{ folder: '/my-files/Public/salsa', name: 'clip.mp4', contentType: 'video/mp4' }])
    expect(applied).toEqual([{ type: 'save-to-drive', service: 'drive-1', paths: ['/my-files/Public/salsa/clip.mp4'] }])
  })

  it('skips a file that is already there with the same name and size', async () => {
    const { drive, uploaded } = fakeDrive([{ name: 'clip.mp4', size: 5 }])

    const { applied } = await runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', accept: ['video/*'] }
    ]), mailItem(), fakeApplier(), saveContext([attachment('clip.mp4', 'video/mp4', 'video')], drive))

    expect(uploaded).toEqual([])
    expect(applied).toEqual([])
  })

  it('renames a same-name file of another size', async () => {
    const { drive, uploaded } = fakeDrive([
      { name: 'clip.mp4', size: 1 },
      { name: 'clip (1).mp4', size: 2 }
    ])

    await runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', accept: ['video/*'] }
    ]), mailItem(), fakeApplier(), saveContext([attachment('clip.mp4', 'video/mp4', 'video')], drive))

    expect(uploaded.map(file => file.name)).toEqual(['clip (2).mp4'])
  })

  it('skips a same-name file of another size when the action says so', async () => {
    const { drive, uploaded } = fakeDrive([{ name: 'clip.mp4', size: 1 }])

    const { applied } = await runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', accept: ['video/*'], conflict: 'skip' }
    ]), mailItem(), fakeApplier(), saveContext([attachment('clip.mp4', 'video/mp4', 'video')], drive))

    expect(uploaded).toEqual([])
    expect(applied).toEqual([])
  })

  it('renames the second of two attachments that share a name', async () => {
    const { drive, uploaded } = fakeDrive()

    const { applied } = await runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', accept: ['image/*'] }
    ]), mailItem(), fakeApplier(), saveContext([
      attachment('photo.jpg', 'image/jpeg', 'first'),
      attachment('photo.jpg', 'image/jpeg', 'second!')
    ], drive))

    expect(uploaded.map(file => file.name)).toEqual(['photo.jpg', 'photo (1).jpg'])
    expect(applied[0]).toMatchObject({
      type: 'save-to-drive',
      paths: ['/my-files/Public/photo.jpg', '/my-files/Public/photo (1).jpg']
    })
  })

  it('succeeds without touching the drive when no attachment matches', async () => {
    const { drive, ensured, listed, uploaded } = fakeDrive()

    const { applied } = await runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', accept: ['video/*'] }
    ]), mailItem(), fakeApplier(), saveContext([attachment('invoice.pdf', 'application/pdf', 'pdf')], drive))

    expect(ensured).toEqual([])
    expect(listed).toEqual([])
    expect(uploaded).toEqual([])
    expect(applied).toEqual([])
  })

  it('stops before a following trash when an upload fails', async () => {
    const applier = fakeApplier()
    const drive: DriveSavePort = {
      async ensureFolder() {},
      async list() { return [] },
      async upload() { throw new Error('Drive is full') }
    }

    await expect(runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', accept: ['video/*'] },
      { type: 'trash' }
    ]), mailItem(), applier, saveContext([attachment('clip.mp4', 'video/mp4', 'video')], drive)))
      .rejects.toThrow('Drive is full')

    expect(applier.calls).toEqual([])
  })

  it('saves the same content once, even when it arrives under another name', async () => {
    const { drive, uploaded } = fakeDrive()
    const { history, recorded } = fakeHistory()

    const { applied } = await runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', accept: ['video/*'] }
    ]), mailItem(), fakeApplier(), saveContext([
      attachment('holiday.mp4', 'video/mp4', 'same video'),
      attachment('holiday-copy.mp4', 'video/mp4', 'same video')
    ], drive, history))

    expect(uploaded.map(file => file.name)).toEqual(['holiday.mp4'])
    expect(applied).toEqual([{ type: 'save-to-drive', service: 'drive-1', paths: ['/my-files/Public/holiday.mp4'] }])
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      service: 'drive-1',
      folder: '/my-files/Public',
      path: '/my-files/Public/holiday.mp4',
      size: 10
    })
  })

  it('renames a same-name attachment when its content differs', async () => {
    const { drive, uploaded } = fakeDrive()

    const { applied } = await runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', accept: ['video/*'] }
    ]), mailItem(), fakeApplier(), saveContext([
      attachment('holiday.mp4', 'video/mp4', 'first video'),
      attachment('holiday.mp4', 'video/mp4', 'the second video')
    ], drive))

    expect(uploaded.map(file => file.name)).toEqual(['holiday.mp4', 'holiday (1).mp4'])
    expect(applied[0]).toMatchObject({
      type: 'save-to-drive',
      paths: ['/my-files/Public/holiday.mp4', '/my-files/Public/holiday (1).mp4']
    })
  })

  it('skips a file whose content was already saved into the folder', async () => {
    const { drive, uploaded } = fakeDrive()
    const content = attachment('new-name.mp4', 'video/mp4', 'known video')
    const sha256 = await sha256Hex(content.content)
    const { history } = fakeHistory([
      { service: 'drive-1', folder: '/my-files/Public', sha256, path: '/my-files/Public/old-name.mp4', size: content.size }
    ])

    const { applied } = await runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', accept: ['video/*'] }
    ]), mailItem(), fakeApplier(), saveContext([content], drive, history))

    expect(uploaded).toEqual([])
    expect(applied).toEqual([])
  })

  it('records each file right after its own upload, so a later failure keeps the earlier row', async () => {
    const { history, recorded } = fakeHistory()
    let calls = 0
    const drive: DriveSavePort = {
      async ensureFolder() {},
      async list() { return [] },
      async upload(_service, _folder, file) {
        calls++
        if (calls === 2) {
          throw new Error('Drive is full')
        }
        expect(file.name).toBe('first.mp4')
      }
    }

    await expect(runActions(planned([
      { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', accept: ['video/*'] }
    ]), mailItem(), fakeApplier(), saveContext([
      attachment('first.mp4', 'video/mp4', 'first video'),
      attachment('second.mp4', 'video/mp4', 'second video')
    ], drive, history))).rejects.toThrow('Drive is full')

    expect(recorded.map(row => row.path)).toEqual(['/my-files/Public/first.mp4'])
  })
})
