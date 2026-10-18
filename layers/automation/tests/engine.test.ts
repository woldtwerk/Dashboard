import { describe, expect, it, vi } from 'vitest'
import { runService } from '../server/utils/engine'
import type { AutomationApplier, AutomationDeps, AutomationStore } from '../server/utils/engine'
import type { SeenState } from '../server/utils/runs'
import type { WorkflowDecide } from '../shared/workflow'
import type {
  AppliedAction,
  AutomationItem,
  AutomationRun,
  AutomationWorkflow,
  DecisionAnswer,
  UndoOperation,
  WorkflowGraph
} from '../shared/types/automation'

function workflow(overrides: Partial<AutomationWorkflow> = {}, graph?: WorkflowGraph): AutomationWorkflow {
  return {
    id: 'w1',
    name: 'Invoices',
    domain: 'mail',
    service: null,
    enabled: true,
    mode: 'suggest',
    position: 0,
    graph: graph ?? actionGraph({ type: 'star' }),
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    ...overrides
  }
}

function actionGraph(action: { type: 'star' } | { type: 'mark-read' } | { type: 'move-to', folder: string }): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
      { id: 'do', type: 'action', position: { x: 0, y: 50 }, data: { action } },
      { id: 'end', type: 'end', position: { x: 200, y: 50 }, data: {} }
    ],
    edges: [
      { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'do' },
      { id: 'e2', source: 'do', sourceHandle: 'next', target: 'end' }
    ]
  }
}

function decisionGraph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
      {
        id: 'kind',
        type: 'decision',
        position: { x: 0, y: 50 },
        data: { question: 'yesno', instructions: 'urgent?', thresholds: { yes: 0.9, no: 0.9 } }
      },
      { id: 'do', type: 'action', position: { x: 0, y: 100 }, data: { action: { type: 'star' } } },
      { id: 'end', type: 'end', position: { x: 200, y: 100 }, data: {} }
    ],
    edges: [
      { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'kind' },
      { id: 'e2', source: 'kind', sourceHandle: 'yes', target: 'do' },
      { id: 'e3', source: 'do', sourceHandle: 'next', target: 'end' },
      { id: 'e4', source: 'kind', sourceHandle: 'no', target: 'end' },
      { id: 'e5', source: 'kind', sourceHandle: 'unsure', target: 'end' }
    ]
  }
}

function item(key = 'INBOX|1|m1'): AutomationItem {
  return {
    domain: 'mail',
    service: 'mail-1',
    key,
    mailbox: 'INBOX',
    uid: 1,
    unread: true,
    flagged: false,
    fields: { subject: 'Invoice' },
    state: 'state',
    title: 'Invoice'
  }
}

interface AttemptRecord {
  itemKey: string
  attempts: number
  nextAttemptAt: Date | null
}

interface FakeStore extends AutomationStore {
  runs: AutomationRun[]
  evaluated: string[]
  attempts: AttemptRecord[]
}

/** A store that models the seen-and-retry table: retries only become due when time passes */
function fakeStore(): FakeStore {
  const runs: AutomationRun[] = []
  const evaluated: string[] = []
  const attempts: AttemptRecord[] = []
  const final = new Set<string>()
  const retryAt = new Map<string, Date | null>()
  const attemptCount = new Map<string, number>()

  return {
    runs,
    evaluated,
    attempts,
    async due(_domain, _service, keys, now): Promise<SeenState[]> {
      return keys
        .filter(key => !final.has(key))
        .filter((key) => {
          const at = retryAt.get(key)
          return at === null || at === undefined || at.getTime() <= now.getTime()
        })
        .map(key => ({ itemKey: key, attempts: attemptCount.get(key) ?? 0 }))
    },
    async markEvaluated(_domain, _service, itemKey) {
      final.add(itemKey)
      evaluated.push(itemKey)
    },
    async recordAttempt(_domain, _service, itemKey, count, next) {
      attemptCount.set(itemKey, count)
      retryAt.set(itemKey, next)
      attempts.push({ itemKey, attempts: count, nextAttemptAt: next })
    },
    async record(input) {
      const run: AutomationRun = { id: `run-${runs.length + 1}`, itemKey: input.item.key, ...input, applied: input.applied ?? [], at: (input.at ?? new Date()).toISOString() } as unknown as AutomationRun
      runs.push(run)
      return run
    }
  }
}

function decideWith(answer: DecisionAnswer): WorkflowDecide {
  return async (_state, questions) => ({ [Object.keys(questions)[0]!]: answer })
}

interface FakeApplier extends AutomationApplier {
  applied: AppliedAction[]
  undone: UndoOperation[]
}

function fakeApplier(options: { fail?: boolean } = {}): FakeApplier {
  const applied: AppliedAction[] = []
  const undone: UndoOperation[] = []

  return {
    applied,
    undone,
    async apply(actions, original) {
      if (options.fail) {
        throw new Error('provider down')
      }
      const records = actions.map<AppliedAction>(action => action.type === 'star'
        ? { type: 'star', mailbox: original.mailbox!, uid: original.uid!, wasFlagged: !!original.flagged }
        : { type: 'mark-read', mailbox: original.mailbox!, uid: original.uid!, wasUnread: true })
      applied.push(...records)
      return { applied: records, item: original }
    },
    async undo(operations) {
      undone.push(...operations)
    }
  }
}

function deps(overrides: Partial<AutomationDeps> & { store: AutomationStore }): AutomationDeps {
  return {
    loadItems: async () => [item()],
    applierFor: () => fakeApplier(),
    ...overrides
  }
}

describe('runService', () => {
  it('records a suggestion in suggest mode without applying anything', async () => {
    const store = fakeStore()
    const applier = fakeApplier()
    const notify = vi.fn()
    const apply = vi.spyOn(applier, 'apply')

    const runs = await runService('mail', 'mail-1', [workflow()], deps({ store, applierFor: () => applier, notify }))

    expect(runs).toHaveLength(1)
    expect(runs[0]!.outcome).toBe('suggested')
    expect(runs[0]!.actions).toEqual([{ nodeId: 'do', action: { type: 'star' } }])
    expect(apply).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledOnce()
    expect(store.evaluated).toEqual(['INBOX|1|m1'])
  })

  it('applies the actions in auto mode and records what to undo', async () => {
    const store = fakeStore()
    const applier = fakeApplier()

    const runs = await runService('mail', 'mail-1', [workflow({ mode: 'auto' })], deps({ store, applierFor: () => applier }))

    expect(runs[0]!.outcome).toBe('applied')
    expect(runs[0]!.applied).toEqual([{ type: 'star', mailbox: 'INBOX', uid: 1, wasFlagged: false }])
    expect(applier.applied).toHaveLength(1)
  })

  it('runs a decision workflow with the engine and branches on its answer', async () => {
    const store = fakeStore()
    const runs = await runService('mail', 'mail-1', [workflow({ graph: decisionGraph() })], deps({
      store,
      decide: decideWith({ yes: 0.95, confidence: 0.9 })
    }))

    expect(runs).toHaveLength(1)
    expect(runs[0]!.answers.kind).toEqual({ yes: 0.95, confidence: 0.9 })
    expect(runs[0]!.actions).toHaveLength(1)
    expect(store.evaluated).toEqual(['INBOX|1|m1'])
  })

  it('records a failed run when an action throws, and keeps going', async () => {
    const store = fakeStore()
    const runs = await runService('mail', 'mail-1', [workflow({ mode: 'auto' })], deps({
      store,
      applierFor: () => fakeApplier({ fail: true })
    }))

    expect(runs[0]!.outcome).toBe('failed')
    expect(runs[0]!.error).toBe('provider down')
    // An action failure is final: the item is not retried
    expect(store.evaluated).toEqual(['INBOX|1|m1'])
  })

  it('marks a workflow whose action type was already taken as skipped', async () => {
    const store = fakeStore()
    const first = workflow({ id: 'first', position: 0 })
    const second = workflow({ id: 'second', position: 1, graph: actionGraph({ type: 'star' }) })

    const runs = await runService('mail', 'mail-1', [first, second], deps({ store }))
    const byWorkflow = new Map(runs.map(run => [run.workflow, run]))

    expect(byWorkflow.get('first')!.actions).toHaveLength(1)
    expect(byWorkflow.get('second')!.outcome).toBe('skipped')
    expect(byWorkflow.get('second')!.actions).toEqual([])
  })

  it('lets a later workflow keep the action types the first did not claim', async () => {
    const store = fakeStore()
    const first = workflow({ id: 'first', position: 0 })
    const second = workflow({ id: 'second', position: 1, graph: actionGraph({ type: 'mark-read' }) })

    const runs = await runService('mail', 'mail-1', [first, second], deps({ store }))
    const byWorkflow = new Map(runs.map(run => [run.workflow, run]))

    expect(byWorkflow.get('second')!.outcome).toBe('suggested')
    expect(byWorkflow.get('second')!.actions).toEqual([{ nodeId: 'do', action: { type: 'mark-read' } }])
  })

  it('evaluates each item once', async () => {
    const store = fakeStore()
    const loader = vi.fn(async () => [item('a'), item('b')])
    const options = deps({ store, loadItems: loader })

    await runService('mail', 'mail-1', [workflow()], options)
    const second = await runService('mail', 'mail-1', [workflow()], options)

    expect(second).toHaveLength(0)
    expect(store.evaluated).toEqual(['a', 'b'])
  })

  it('ignores a workflow scoped to another service', async () => {
    const store = fakeStore()
    const runs = await runService('mail', 'mail-1', [workflow({ service: 'mail-2' })], deps({ store }))
    expect(runs).toHaveLength(0)
  })
})

describe('runService retries', () => {
  it('does not evaluate an item when the engine is down, and retries it after the backoff', async () => {
    const store = fakeStore()
    const decide = vi.fn<WorkflowDecide>(async () => {
      throw new Error('laya-serve answered 503')
    })
    let now = new Date('2026-10-18T10:00:00.000Z')
    const options = deps({ store, decide, now: () => now })

    await runService('mail', 'mail-1', [workflow({ graph: decisionGraph() })], options)

    expect(store.evaluated).toEqual([])
    expect(store.attempts).toEqual([{ itemKey: 'INBOX|1|m1', attempts: 1, nextAttemptAt: new Date(now.getTime() + 60_000) }])

    // Before the retry is due, the item is left alone
    await runService('mail', 'mail-1', [workflow({ graph: decisionGraph() })], options)
    expect(decide).toHaveBeenCalledTimes(1)

    // After it, the engine answers and the item is evaluated
    now = new Date(now.getTime() + 61_000)
    decide.mockImplementation(decideWith({ yes: 0.95, confidence: 0.9 }))
    const runs = await runService('mail', 'mail-1', [workflow({ graph: decisionGraph() })], options)

    expect(runs).toHaveLength(1)
    expect(store.evaluated).toEqual(['INBOX|1|m1'])
    expect(store.attempts).toHaveLength(1)
  })

  it('retries a missing engine and records no run until it is configured', async () => {
    const store = fakeStore()
    const options = deps({ store })

    const runs = await runService('mail', 'mail-1', [workflow({ graph: decisionGraph() })], options)

    expect(runs).toHaveLength(0)
    expect(store.evaluated).toEqual([])
    expect(store.attempts[0]!.attempts).toBe(1)
  })

  it('gives up after the backoff schedule, records a failed run and notifies', async () => {
    const store = fakeStore()
    const notifyFailed = vi.fn()
    let now = new Date('2026-10-18T10:00:00.000Z')
    const options = deps({
      store,
      decide: async () => { throw new Error('network down') },
      notifyFailed,
      now: () => now
    })

    for (let attempt = 0; attempt < 3; attempt++) {
      await runService('mail', 'mail-1', [workflow({ graph: decisionGraph(), mode: 'auto' })], options)
      const scheduled = store.attempts.at(-1)!.nextAttemptAt!
      now = new Date(scheduled.getTime() + 1)
    }

    const runs = await runService('mail', 'mail-1', [workflow({ graph: decisionGraph(), mode: 'auto' })], options)

    expect(store.attempts.map(record => record.attempts)).toEqual([1, 2, 3, 4])
    expect(store.attempts.at(-1)!.nextAttemptAt).toBeNull()
    expect(store.evaluated).toEqual([])
    expect(runs.some(run => run.outcome === 'failed')).toBe(true)
    expect(notifyFailed).toHaveBeenCalledOnce()
  })
})
