import { describe, expect, it } from 'vitest'
import {
  buildDocumentState,
  buildMailState,
  isPendingRun,
  matchesCondition,
  matchesConditions,
  nextAttempt,
  pendingRunIds,
  planUndo,
  runConfidence,
  selectActions,
  toCorrectionExample,
  undoBatches
} from '../shared/automation'
import type { AppliedAction, AutomationItem, PlannedAction, UndoOperation } from '../shared/types/automation'

function mailItem(fields: Record<string, string> = {}): AutomationItem {
  return {
    domain: 'mail',
    service: 'mail-1',
    key: 'INBOX|1|m1',
    mailbox: 'INBOX',
    uid: 1,
    unread: true,
    flagged: false,
    fields,
    state: 'state',
    title: 'Invoice'
  }
}

describe('matchesCondition', () => {
  it('contains is case-insensitive', () => {
    expect(matchesCondition('Rechnung von Acme', { field: 'subject', op: 'contains', value: 'rechnung' })).toBe(true)
    expect(matchesCondition('Rechnung', { field: 'subject', op: 'contains', value: 'angebot' })).toBe(false)
  })

  it('equals compares the whole, case-insensitively', () => {
    expect(matchesCondition('INVOICE', { field: 'subject', op: 'equals', value: 'invoice' })).toBe(true)
    expect(matchesCondition('invoice 2026', { field: 'subject', op: 'equals', value: 'invoice' })).toBe(false)
  })

  it('matches uses a case-insensitive regular expression', () => {
    expect(matchesCondition('RE-2026-0042', { field: 'subject', op: 'matches', value: '^re-\\d{4}' })).toBe(true)
    // An invalid pattern matches nothing rather than everything
    expect(matchesCondition('anything', { field: 'subject', op: 'matches', value: '(' })).toBe(false)
  })

  it('never matches a missing field', () => {
    expect(matchesCondition(undefined, { field: 'from', op: 'contains', value: 'x' })).toBe(false)
  })
})

describe('matchesConditions', () => {
  it('matches everything when there are no conditions', () => {
    expect(matchesConditions(mailItem(), { combine: 'any', conditions: [] })).toBe(true)
  })

  it('ignores a half-typed condition with an empty value', () => {
    const item = mailItem({ subject: 'Hello' })
    expect(matchesConditions(item, { combine: 'all', conditions: [{ field: 'from', op: 'contains', value: '' }] })).toBe(true)
  })

  it('combines with all and any', () => {
    const item = mailItem({ subject: 'Invoice', from: 'billing@acme.test' })
    const invoice = { field: 'subject' as const, op: 'contains' as const, value: 'invoice' }
    const newsletter = { field: 'subject' as const, op: 'contains' as const, value: 'newsletter' }

    expect(matchesConditions(item, { combine: 'all', conditions: [invoice, newsletter] })).toBe(false)
    expect(matchesConditions(item, { combine: 'any', conditions: [invoice, newsletter] })).toBe(true)
  })
})

describe('selectActions', () => {
  it('lets the first workflow own each action type', () => {
    const first: PlannedAction[] = [
      { nodeId: 'a1', action: { type: 'move-to', folder: 'Archive' } },
      { nodeId: 'a2', action: { type: 'star' } }
    ]
    const second: PlannedAction[] = [
      { nodeId: 'b1', action: { type: 'move-to', folder: 'Other' } },
      { nodeId: 'b2', action: { type: 'label', label: 'L' } }
    ]

    expect(selectActions([{ id: 'first', actions: first }, { id: 'second', actions: second }])).toEqual([
      { workflow: 'first', nodeId: 'a1', action: { type: 'move-to', folder: 'Archive' } },
      { workflow: 'first', nodeId: 'a2', action: { type: 'star' } },
      { workflow: 'second', nodeId: 'b2', action: { type: 'label', label: 'L' } }
    ])
  })

  it('keeps every generic action, so several notifications are not collapsed', () => {
    const actions: PlannedAction[] = [
      { nodeId: 'e1', action: { type: 'extract', variable: 'code', extractor: 'login-code' } },
      { nodeId: 'n1', action: { type: 'notify', title: 'One' } },
      { nodeId: 'n2', action: { type: 'notify', title: 'Two' } }
    ]

    expect(selectActions([{ id: 'w1', actions }])).toEqual([
      { workflow: 'w1', nodeId: 'e1', action: { type: 'extract', variable: 'code', extractor: 'login-code' } },
      { workflow: 'w1', nodeId: 'n1', action: { type: 'notify', title: 'One' } },
      { workflow: 'w1', nodeId: 'n2', action: { type: 'notify', title: 'Two' } }
    ])
  })
})

describe('planUndo', () => {
  it('reverses a move to the source mailbox using the new uid', () => {
    const applied: AppliedAction[] = [{ type: 'move-to', folder: 'Archive', from: 'INBOX', uid: 9 }]
    expect(planUndo(applied)).toEqual([{ op: 'move', mailbox: 'Archive', uid: 9, target: 'INBOX' }])
  })

  it('deletes a label copy and clears the flags it set', () => {
    const applied: AppliedAction[] = [
      { type: 'label', label: 'Invoices', labelMailbox: 'Labels/Invoices', uid: 42 },
      { type: 'mark-read', mailbox: 'INBOX', uid: 1, wasUnread: true },
      { type: 'star', mailbox: 'INBOX', uid: 1, wasFlagged: false }
    ]
    expect(planUndo(applied)).toEqual([
      { op: 'set-flagged', mailbox: 'INBOX', uid: 1, flagged: false },
      { op: 'set-seen', mailbox: 'INBOX', uid: 1, seen: false },
      { op: 'delete', mailbox: 'Labels/Invoices', uid: 42 }
    ])
  })

  it('restores document metadata', () => {
    const applied: AppliedAction[] = [
      { type: 'add-tag', document: 7, tag: 3, previousTags: [1, 2] },
      { type: 'set-correspondent', document: 7, correspondent: 5, previous: null },
      { type: 'set-type', document: 7, documentType: 4, previous: 2 }
    ]
    expect(planUndo(applied)).toEqual([
      { op: 'set-document-type', document: 7, documentType: 2 },
      { op: 'set-correspondent', document: 7, correspondent: null },
      { op: 'set-tags', document: 7, tags: [1, 2] }
    ])
  })

  it('drops a reversal it cannot perform without a uid', () => {
    expect(planUndo([{ type: 'move-to', folder: 'Archive', from: 'INBOX' }])).toEqual([])
  })

  it('reverses nothing for an extract or a notification', () => {
    expect(planUndo([
      { type: 'extract', variable: 'code', value: '482913' },
      { type: 'notify', nodeId: 'notify', title: 'Login code', modal: { text: '482913', copy: true } }
    ])).toEqual([])
  })

  it('trashes the files a save-to-drive uploaded', () => {
    expect(planUndo([
      { type: 'save-to-drive', service: 'drive-1', paths: ['/my-files/Public/a.pdf', '/my-files/Public/b.pdf'] }
    ])).toEqual([
      { op: 'drive-trash', service: 'drive-1', paths: ['/my-files/Public/a.pdf', '/my-files/Public/b.pdf'] }
    ])
  })

  it('plans nothing for a save-to-drive that saved no file', () => {
    expect(planUndo([{
      type: 'save-to-drive',
      service: 'drive-1',
      paths: [],
      skipped: [{ name: 'a.pdf', reason: 'duplicate' }],
      matched: 1
    }])).toEqual([])
  })

  it('cancels the requests of a split', () => {
    expect(planUndo([{ type: 'request-payment', requestIds: ['req-1', 'req-2'], sent: ['req-1'] }])).toEqual([
      { op: 'payment-cancel', requests: ['req-1', 'req-2'] }
    ])
  })

  it('reopens only a request this run marked paid', () => {
    expect(planUndo([
      { type: 'confirm-paypal-payment', outcome: 'paid', requestId: 'req-1', cents: 283, paidCents: 283 },
      { type: 'confirm-paypal-payment', outcome: 'already-paid', requestId: 'req-2', cents: 283 },
      { type: 'confirm-paypal-payment', outcome: 'unverified' }
    ])).toEqual([{ op: 'payment-unpay', requestId: 'req-1', paidCents: 283 }])
  })
})

describe('undoBatches', () => {
  const move: UndoOperation = { op: 'move', mailbox: 'Trash', uid: 9, target: 'INBOX' }
  const drive: UndoOperation = { op: 'drive-trash', service: 'drive-1', paths: ['/my-files/Public/a.pdf'] }

  it('keeps consecutive domain operations in one applier batch', () => {
    expect(undoBatches([move, { op: 'set-seen', mailbox: 'Trash', uid: 9, seen: true }])).toEqual([
      { kind: 'domain', operations: [move, { op: 'set-seen', mailbox: 'Trash', uid: 9, seen: true }] }
    ])
  })

  it('runs a drive trash where it stands in the plan', () => {
    expect(undoBatches([move, drive, { op: 'delete', mailbox: 'Labels/x', uid: 4 }])).toEqual([
      { kind: 'domain', operations: [move] },
      { kind: 'drive', service: 'drive-1', paths: ['/my-files/Public/a.pdf'] },
      { kind: 'domain', operations: [{ op: 'delete', mailbox: 'Labels/x', uid: 4 }] }
    ])
  })

  it('runs payment steps where they stand in the plan', () => {
    expect(undoBatches([
      move,
      { op: 'payment-cancel', requests: ['req-1'] },
      { op: 'payment-unpay', requestId: 'req-2', paidCents: 283 }
    ])).toEqual([
      { kind: 'domain', operations: [move] },
      { kind: 'payment-cancel', requests: ['req-1'] },
      { kind: 'payment-unpay', requestId: 'req-2', paidCents: 283 }
    ])
  })

  it('has nothing to do without operations', () => {
    expect(undoBatches([])).toEqual([])
  })
})

describe('state builders', () => {
  it('puts the sender and subject above the body', () => {
    expect(buildMailState('a@b.test', 'Invoice', 'body')).toBe('From: a@b.test\nSubject: Invoice\n\nbody')
  })

  it('caps a long body', () => {
    const state = buildMailState('a', 'b', 'x'.repeat(5000))
    expect(state.endsWith('…')).toBe(true)
    expect(state.length).toBeLessThan(4100)
  })

  it('puts the title above the content', () => {
    expect(buildDocumentState('Invoice', 'text')).toBe('Title: Invoice\n\ntext')
  })
})

describe('nextAttempt', () => {
  const now = new Date('2026-10-18T10:00:00.000Z')

  it('backs off by 1, 5 and 30 minutes', () => {
    expect(nextAttempt(1, now)?.toISOString()).toBe('2026-10-18T10:01:00.000Z')
    expect(nextAttempt(2, now)?.toISOString()).toBe('2026-10-18T10:05:00.000Z')
    expect(nextAttempt(3, now)?.toISOString()).toBe('2026-10-18T10:30:00.000Z')
  })

  it('gives up on the attempt after the last backoff', () => {
    expect(nextAttempt(4, now)).toBeNull()
    expect(nextAttempt(5, now)).toBeNull()
  })

  it('treats a non-positive attempt count as no retry', () => {
    expect(nextAttempt(0, now)).toBeNull()
  })
})

describe('runConfidence', () => {
  it('reports the highest answer confidence', () => {
    expect(runConfidence({ a: { confidence: 0.4 }, b: { confidence: 0.9 } })).toBe(0.9)
  })

  it('is undefined without answers', () => {
    expect(runConfidence({})).toBeUndefined()
  })
})

describe('workflow deletion', () => {
  const runs = [
    { id: 'r1', workflow: 'w1', outcome: 'suggested' as const },
    { id: 'r2', workflow: 'w1', outcome: 'applied' as const },
    { id: 'r3', workflow: 'w1', outcome: 'failed' as const },
    { id: 'r4', workflow: 'w1', outcome: 'undone' as const },
    { id: 'r5', workflow: 'w1', outcome: 'skipped' as const },
    { id: 'r6', workflow: 'w2', outcome: 'suggested' as const }
  ]

  it('drops only the pending suggestions and keeps the run history', () => {
    expect(pendingRunIds(runs, 'w1')).toEqual(['r1'])
    expect(pendingRunIds(runs, 'w2')).toEqual(['r6'])
    expect(pendingRunIds(runs, 'w1')).not.toContain('r2')
  })

  it('knows which outcomes are still pending', () => {
    expect(runs.filter(isPendingRun).map(run => run.id)).toEqual(['r1', 'r6'])
  })
})

describe('toCorrectionExample', () => {
  it('keeps the state, the answers and the reaction', () => {
    const example = toCorrectionExample({
      id: 'run-1',
      workflow: 'w1',
      workflowName: 'Invoices',
      domain: 'mail',
      service: 'mail-1',
      itemKey: 'k',
      item: mailItem({ subject: 'Invoice' }),
      path: [{ nodeId: 'd1', output: 'invoice', answer: { choice: 'invoice', confidence: 0.9 } }],
      answers: { d1: { choice: 'invoice', confidence: 0.9 } },
      outcome: 'suggested',
      actions: [{ nodeId: 'a1', action: { type: 'star' } }],
      applied: [],
      feedback: 'rejected',
      at: new Date().toISOString()
    })

    expect(example).toMatchObject({
      domain: 'mail',
      workflow: 'w1',
      actions: [{ nodeId: 'a1', action: { type: 'star' } }],
      feedback: 'rejected',
      answers: { d1: { choice: 'invoice', confidence: 0.9 } }
    })
  })

  it('labels the node a human decided and keeps the answered feedback', () => {
    const example = toCorrectionExample({
      id: 'run-2',
      workflow: 'w1',
      workflowName: 'Invoices',
      domain: 'mail',
      service: 'mail-1',
      itemKey: 'k',
      item: mailItem(),
      path: [
        { nodeId: 'd1', output: 'other', source: 'engine', attempts: [{ source: 'engine', output: 'other' }] },
        { nodeId: 'd2', output: 'invoice', source: 'human', attempts: [{ source: 'ai', output: 'other' }] }
      ],
      answers: { d2: { choice: 'invoice', confidence: 0.9 } },
      outcome: 'applied',
      actions: [{ nodeId: 'a1', action: { type: 'star' } }],
      applied: [],
      feedback: 'answered',
      at: new Date().toISOString()
    })

    expect(example.labels).toEqual({ d2: 'invoice' })
    expect(example.feedback).toBe('answered')
  })
})
