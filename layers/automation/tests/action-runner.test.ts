import { describe, expect, it } from 'vitest'
import { extractValue, runActions } from '../server/utils/action-runner'
import type { AutomationApplier } from '../server/utils/engine'
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
