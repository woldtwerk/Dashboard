import { describe, expect, it, vi } from 'vitest'
import { answerReview, runService, runWorkflowOnItems } from '../server/utils/engine'
import type { AutomationApplier, AutomationDeps, AutomationStore } from '../server/utils/engine'
import { MANUAL_RUN_LOST_LOCK, runManualGroups } from '../server/utils/manual-run'
import type { ManualRunEntry } from '../server/utils/manual-run'
import type { SeenState } from '../server/utils/runs'
import type { WorkflowDecide, WorkflowDecideBatch } from '../shared/workflow'
import type {
  AppliedAction,
  AutomationDomain,
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

/** A workflow that extracts the login code and notifies with it in a pop-up */
function notifyGraph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
      { id: 'extract', type: 'action', position: { x: 0, y: 50 }, data: { action: { type: 'extract', variable: 'code', extractor: 'login-code' } } },
      {
        id: 'notify',
        type: 'action',
        position: { x: 0, y: 100 },
        data: { action: { type: 'notify', title: 'Login code from {{from}}', modal: { text: '{{code}}', copy: true } } }
      },
      { id: 'end', type: 'end', position: { x: 200, y: 100 }, data: {} }
    ],
    edges: [
      { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'extract' },
      { id: 'e2', source: 'extract', sourceHandle: 'next', target: 'notify' },
      { id: 'e3', source: 'notify', sourceHandle: 'next', target: 'end' }
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

function item(key = 'INBOX|1|m1', overrides: Partial<AutomationItem> = {}): AutomationItem {
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
    title: 'Invoice',
    ...overrides
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
      const run: AutomationRun = { id: input.id ?? `run-${runs.length + 1}`, itemKey: input.item.key, ...input, applied: input.applied ?? [], at: (input.at ?? new Date()).toISOString() } as unknown as AutomationRun
      runs.push(run)
      return run
    },
    async get(id) {
      const run = runs.find(candidate => candidate.id === id)
      if (!run) {
        throw new Error(`Unknown run ${id}`)
      }
      return run
    },
    async update(id, patch) {
      const index = runs.findIndex(candidate => candidate.id === id)
      if (index < 0) {
        throw new Error(`Unknown run ${id}`)
      }
      const updated = { ...runs[index]!, ...patch } as AutomationRun
      runs[index] = updated
      return updated
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

  it('announces the notifications after the applied run is recorded', async () => {
    const store = fakeStore()
    const announceNotifications = vi.fn()
    const applier = fakeApplier()
    const apply = vi.spyOn(applier, 'apply')

    const runs = await runService('mail', 'mail-1', [workflow({ mode: 'auto', graph: notifyGraph() })], deps({
      store,
      applierFor: () => applier,
      announceNotifications,
      loadItems: async () => [item(undefined, { fields: { text: 'Your verification code is 482913' } })]
    }))

    expect(runs[0]!.outcome).toBe('applied')
    expect(runs[0]!.error).toBeUndefined()
    expect(runs[0]!.applied.map(action => action.type)).toEqual(['extract', 'notify'])
    expect(apply).not.toHaveBeenCalled()
    expect(announceNotifications).toHaveBeenCalledOnce()
    // The run exists before the announcement, so the modal can be tied to its id
    const [announced] = announceNotifications.mock.calls[0]!
    expect(announced.id).toBe(runs[0]!.id)
    expect(store.runs.map(run => run.id)).toContain(announced.id)
  })

  it('logs but does not fail the run when the notification announcement fails', async () => {
    const store = fakeStore()
    const warn = vi.fn()

    const runs = await runService('mail', 'mail-1', [workflow({ mode: 'auto', graph: notifyGraph() })], deps({
      store,
      announceNotifications: async () => { throw new Error('broker down') },
      logger: { warn },
      loadItems: async () => [item(undefined, { fields: { text: 'Your verification code is 482913' } })]
    }))

    expect(runs[0]!.outcome).toBe('applied')
    expect(warn).toHaveBeenCalled()
  })

  it('does not announce when the applied run carries no notification', async () => {
    const store = fakeStore()
    const announceNotifications = vi.fn()

    await runService('mail', 'mail-1', [workflow({ mode: 'auto' })], deps({ store, announceNotifications }))

    expect(announceNotifications).not.toHaveBeenCalled()
  })

  it('fails the run when an extract finds nothing, so a following action never runs', async () => {
    const store = fakeStore()
    const applier = fakeApplier()
    const apply = vi.spyOn(applier, 'apply')

    const runs = await runService('mail', 'mail-1', [workflow({ mode: 'auto', graph: notifyGraph() })], deps({
      store,
      applierFor: () => applier,
      loadItems: async () => [item(undefined, { fields: { text: 'Your invoice 123456789012 is attached.' } })]
    }))

    expect(runs[0]!.outcome).toBe('failed')
    expect(runs[0]!.error).toBe('No code found')
    expect(apply).not.toHaveBeenCalled()
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

  it('answers the loader’s due check from the store, so nothing due is never loaded', async () => {
    const store = fakeStore()
    const at = new Date('2026-10-18T10:00:00.000Z')
    await store.markEvaluated('mail', 'mail-1', 'a', at)
    await store.markEvaluated('mail', 'mail-1', 'b', at)

    let dueKeys: string[] | undefined
    const loadItems = vi.fn(async (_domain: AutomationDomain, _service: string, _limit: number, isDue: (keys: string[]) => Promise<Set<string>>) => {
      const due = await isDue(['a', 'b'])
      dueKeys = [...due]
      // The real loader only fetches the bodies of these; an empty set means no provider call
      return [item('a'), item('b')].filter(candidate => due.has(candidate.key))
    })

    const runs = await runService('mail', 'mail-1', [workflow()], deps({ store, loadItems }))

    expect(dueKeys).toEqual([])
    expect(runs).toHaveLength(0)
    expect(store.evaluated).toEqual(['a', 'b'])
  })
})

describe('runService retries', () => {
  it('uses one batch call per decision node for a wave of items', async () => {
    const store = fakeStore()
    const decideBatch = vi.fn<WorkflowDecideBatch>(async (states, questions) => states.map(() => ({ [Object.keys(questions)[0]!]: { yes: 0.95, confidence: 0.9 } })))
    const decide = vi.fn<WorkflowDecide>(async () => {
      throw new Error('the single decider must not be called when a batch one exists')
    })

    const runs = await runService('mail', 'mail-1', [workflow({ graph: decisionGraph() })], deps({
      store,
      decide,
      decideBatch,
      loadItems: async () => [item('a'), item('b'), item('c')]
    }))

    expect(decideBatch).toHaveBeenCalledTimes(1)
    expect(decideBatch.mock.calls[0]![0]).toEqual(['state', 'state', 'state'])
    expect(decide).not.toHaveBeenCalled()
    expect(runs).toHaveLength(3)
    expect(store.evaluated).toEqual(['a', 'b', 'c'])
  })

  it('retries the item when a batch decision call fails', async () => {
    const store = fakeStore()
    const decideBatch = vi.fn<WorkflowDecideBatch>(async () => {
      throw new Error('laya-serve answered 503')
    })

    await runService('mail', 'mail-1', [workflow({ graph: decisionGraph() })], deps({ store, decideBatch }))

    expect(store.evaluated).toEqual([])
    expect(store.attempts[0]!.attempts).toBe(1)
  })

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

/** A decision with an action behind `yes` and a human fallback for an unsure answer */
function reviewGraph(action: { type: 'star' } | { type: 'mark-read' } = { type: 'star' }): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
      {
        id: 'kind',
        type: 'decision',
        position: { x: 0, y: 50 },
        data: { question: 'yesno', instructions: 'urgent?', thresholds: { yes: 0.9, no: 0.9 }, fallbacks: [{ type: 'human' }] }
      },
      { id: 'do', type: 'action', position: { x: 0, y: 100 }, data: { action } },
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

/** A workflow that reaches the end without planning an action */
function endGraph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
      { id: 'end', type: 'end', position: { x: 200, y: 0 }, data: {} }
    ],
    edges: [
      { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'end' }
    ]
  }
}

/** The review graph, but `yes` extracts a code and notifies with it */
function notifyReviewGraph(): WorkflowGraph {
  const graph = reviewGraph()
  const doNode = graph.nodes.find(node => node.id === 'do')!
  doNode.data = { action: { type: 'extract', variable: 'code', extractor: 'login-code' } }
  graph.nodes.push({
    id: 'notify',
    type: 'action',
    position: { x: 0, y: 150 },
    data: { action: { type: 'notify', title: 'Login code from {{from}}', modal: { text: '{{code}}', copy: true } } }
  })
  graph.edges = graph.edges.map(edge => edge.id === 'e3' ? { ...edge, source: 'notify' } : edge)
  graph.edges.push({ id: 'e6', source: 'do', sourceHandle: 'next', target: 'notify' })
  return graph
}

/** Two decisions in a row, each paused by a human fallback */
function twoReviewGraph(): WorkflowGraph {
  const graph = reviewGraph()
  const first = graph.nodes.find(node => node.id === 'kind')
  if (first && first.type === 'decision') {
    first.data = { ...first.data, instructions: 'first?' }
  }
  graph.nodes.push({
    id: 'second',
    type: 'decision',
    position: { x: 200, y: 50 },
    data: { question: 'yesno', instructions: 'second?', thresholds: { yes: 0.9, no: 0.9 }, fallbacks: [{ type: 'human' }] }
  })
  graph.edges = graph.edges.map(edge => edge.id === 'e2' ? { ...edge, target: 'second' } : edge)
  graph.edges.push({ id: 'e6', source: 'second', sourceHandle: 'yes', target: 'do' })
  return graph
}

/** A stored, paused review run for the walk to resume */
function pausedRun(store: FakeStore, overrides: Partial<AutomationItem> = {}): Promise<AutomationRun> {
  return store.record({
    workflow: 'w1',
    workflowName: 'Invoices',
    domain: 'mail',
    service: 'mail-1',
    item: item(undefined, overrides),
    path: [
      { nodeId: 'trigger', output: 'next' },
      {
        nodeId: 'kind',
        output: 'review',
        attempts: [{ source: 'engine', output: 'unsure', answer: { yes: 0.5, confidence: 0.5 } }],
        review: { instructions: 'urgent?', outputs: ['yes', 'no', 'unsure'] }
      }
    ],
    answers: {},
    outcome: 'review',
    actions: []
  })
}

const unsure: WorkflowDecideBatch = async (states, questions) => states.map(() => ({
  [Object.keys(questions)[0]!]: { yes: 0.5, confidence: 0.5 }
}))

describe('reviews', () => {
  it('records a paused run with outcome review, notifies it and keeps its action out of first-wins', async () => {
    const store = fakeStore()
    const notify = vi.fn()
    const onReviewChange = vi.fn()
    const review = workflow({ id: 'review', position: 0, graph: reviewGraph() })
    const action = workflow({ id: 'action', position: 1, graph: actionGraph({ type: 'star' }) })

    const runs = await runService('mail', 'mail-1', [review, action], deps({
      store,
      notify,
      onReviewChange,
      decide: decideWith({ yes: 0.5, confidence: 0.5 })
    }))
    const byWorkflow = new Map(runs.map(run => [run.workflow, run]))

    expect(byWorkflow.get('review')!.outcome).toBe('review')
    expect(byWorkflow.get('review')!.actions).toEqual([])
    expect(byWorkflow.get('review')!.path.at(-1)!.output).toBe('review')
    // The review acts later, so it does not claim the star from the ready workflow
    expect(byWorkflow.get('action')!.outcome).toBe('suggested')
    expect(byWorkflow.get('action')!.actions).toEqual([{ nodeId: 'do', action: { type: 'star' } }])
    expect(notify).toHaveBeenCalledTimes(2)
    // Only the run that waits for a human moves the review badge
    expect(onReviewChange).toHaveBeenCalledOnce()
    expect(onReviewChange.mock.calls[0]![0].id).toBe(byWorkflow.get('review')!.id)
  })
})

describe('answerReview', () => {
  function reviewDeps(store: FakeStore, overrides: {
    graph?: WorkflowGraph
    mode?: AutomationWorkflow['mode']
    applier?: FakeApplier
    decideBatch?: WorkflowDecideBatch
    notify?: (run: AutomationRun) => Promise<void>
    announceNotifications?: (run: AutomationRun) => Promise<void>
    onReviewChange?: (run: AutomationRun) => Promise<void>
    workflowMissing?: boolean
  } = {}) {
    const applier = overrides.applier ?? fakeApplier()
    return {
      applier,
      reviewDeps: {
        store,
        loadWorkflow: async () => overrides.workflowMissing
          ? undefined
          : workflow({ id: 'w1', mode: overrides.mode ?? 'auto', graph: overrides.graph ?? reviewGraph() }),
        decideBatch: overrides.decideBatch ?? unsure,
        fallbackDecideBatch: undefined,
        applierFor: () => applier,
        notify: overrides.notify,
        announceNotifications: overrides.announceNotifications,
        onReviewChange: overrides.onReviewChange
      }
    }
  }

  it('applies the planned actions in auto mode and marks the run answered', async () => {
    const store = fakeStore()
    const { applier, reviewDeps: context } = reviewDeps(store, { mode: 'auto' })
    const run = await pausedRun(store)

    const updated = await answerReview(run.id, 'yes', context)

    expect(updated.outcome).toBe('applied')
    expect(updated.feedback).toBe('answered')
    expect(updated.actions).toEqual([{ nodeId: 'do', action: { type: 'star' } }])
    expect(updated.applied).toEqual([{ type: 'star', mailbox: 'INBOX', uid: 1, wasFlagged: false }])
    expect(applier.applied).toHaveLength(1)
    // The paused node now carries the human's answer
    const step = updated.path.find(candidate => candidate.nodeId === 'kind')!
    expect(step).toMatchObject({ output: 'yes', source: 'human' })
    expect(step.attempts).toEqual([{ source: 'engine', output: 'unsure', answer: { yes: 0.5, confidence: 0.5 } }])
  })

  it('announces the notification after a review resumes into an applied run', async () => {
    const store = fakeStore()
    const announceNotifications = vi.fn()
    const { reviewDeps: context } = reviewDeps(store, {
      mode: 'auto',
      graph: notifyReviewGraph(),
      announceNotifications
    })
    const run = await pausedRun(store, { fields: { subject: 'Invoice', text: 'Your verification code is 482913' } })

    const updated = await answerReview(run.id, 'yes', context)

    expect(updated.outcome).toBe('applied')
    expect(updated.applied.map(action => action.type)).toEqual(['extract', 'notify'])
    expect(announceNotifications).toHaveBeenCalledOnce()
    expect(announceNotifications.mock.calls[0]![0].id).toBe(updated.id)
  })

  it('announces that the run no longer waits for a review', async () => {
    const store = fakeStore()
    const onReviewChange = vi.fn()
    const { reviewDeps: context } = reviewDeps(store, { mode: 'auto', onReviewChange })
    const run = await pausedRun(store)

    const updated = await answerReview(run.id, 'yes', context)

    expect(updated.outcome).toBe('applied')
    expect(onReviewChange).toHaveBeenCalledOnce()
    expect(onReviewChange.mock.calls[0]![0].id).toBe(updated.id)
    expect(onReviewChange.mock.calls[0]![0].outcome).toBe('applied')
  })

  it('suggests in suggest mode and notifies', async () => {
    const store = fakeStore()
    const notify = vi.fn()
    const { reviewDeps: context } = reviewDeps(store, { mode: 'suggest', notify })
    const run = await pausedRun(store)

    const updated = await answerReview(run.id, 'yes', context)

    expect(updated.outcome).toBe('suggested')
    expect(updated.feedback).toBe('answered')
    expect(updated.actions).toEqual([{ nodeId: 'do', action: { type: 'star' } }])
    expect(notify).toHaveBeenCalledOnce()
  })

  it('skips when the answer leads to no action', async () => {
    const store = fakeStore()
    const { reviewDeps: context } = reviewDeps(store, { mode: 'auto' })
    const run = await pausedRun(store)

    const updated = await answerReview(run.id, 'no', context)

    expect(updated.outcome).toBe('skipped')
    expect(updated.feedback).toBe('answered')
    expect(updated.actions).toEqual([])
  })

  it('keeps the run in review when a later decision also asks for a human', async () => {
    const store = fakeStore()
    const { reviewDeps: context } = reviewDeps(store, { mode: 'auto', graph: twoReviewGraph() })
    const run = await pausedRun(store)

    const updated = await answerReview(run.id, 'yes', context)

    expect(updated.outcome).toBe('review')
    expect(updated.feedback).toBe('answered')
    expect(updated.path.at(-1)!.nodeId).toBe('second')
    expect(updated.path.at(-1)!.output).toBe('review')
  })

  it('rejects an output the decision does not offer', async () => {
    const store = fakeStore()
    const { reviewDeps: context } = reviewDeps(store)
    const run = await pausedRun(store)

    await expect(answerReview(run.id, 'nope', context)).rejects.toMatchObject({ status: 400 })
  })

  it('refuses to answer a run that is not in review', async () => {
    const store = fakeStore()
    const { reviewDeps: context } = reviewDeps(store)
    const run = await store.record({
      workflow: 'w1',
      workflowName: 'Invoices',
      domain: 'mail',
      service: 'mail-1',
      item: item(),
      path: [],
      answers: {},
      outcome: 'suggested',
      actions: []
    })

    await expect(answerReview(run.id, 'yes', context)).rejects.toMatchObject({ status: 409 })
  })

  it('refuses when the workflow is gone', async () => {
    const store = fakeStore()
    const { reviewDeps: context } = reviewDeps(store, { workflowMissing: true })
    const run = await pausedRun(store)

    await expect(answerReview(run.id, 'yes', context)).rejects.toMatchObject({ status: 409 })
  })
})

describe('runWorkflowOnItems', () => {
  it('applies the actions in auto mode and marks nothing as evaluated', async () => {
    const store = fakeStore()
    const applier = fakeApplier()

    const results = await runWorkflowOnItems(workflow({ mode: 'auto' }), [item()], deps({ store, applierFor: () => applier }))

    expect(results).toEqual([{ ref: 'mail:mail-1:INBOX%2F1', outcome: 'applied', runId: store.runs[0]!.id, error: undefined }])
    expect(store.runs[0]!.outcome).toBe('applied')
    expect(applier.applied).toHaveLength(1)
    // A manual run must not hide the item from the trigger path
    expect(store.evaluated).toEqual([])
    expect(store.attempts).toEqual([])
  })

  it('records a suggestion in suggest mode without applying it', async () => {
    const store = fakeStore()
    const applier = fakeApplier()
    const notify = vi.fn()
    const apply = vi.spyOn(applier, 'apply')

    const results = await runWorkflowOnItems(workflow(), [item()], deps({ store, applierFor: () => applier, notify }))

    expect(results[0]!.outcome).toBe('suggested')
    expect(store.runs[0]!.actions).toEqual([{ nodeId: 'do', action: { type: 'star' } }])
    expect(apply).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledOnce()
    expect(store.evaluated).toEqual([])
  })

  it('pauses on a human fallback as a review run', async () => {
    const store = fakeStore()
    const notify = vi.fn()

    const results = await runWorkflowOnItems(
      workflow({ graph: reviewGraph() }),
      [item()],
      deps({ store, notify, decide: decideWith({ yes: 0.5, confidence: 0.5 }) })
    )

    expect(results[0]!.outcome).toBe('review')
    expect(store.runs[0]!.outcome).toBe('review')
    expect(store.runs[0]!.path.at(-1)!.output).toBe('review')
    expect(notify).toHaveBeenCalledOnce()
    expect(store.evaluated).toEqual([])
    expect(store.attempts).toEqual([])
  })

  it('reports a decision engine failure as failed, with no retry bookkeeping', async () => {
    const store = fakeStore()
    const notifyFailed = vi.fn()
    const decide = vi.fn<WorkflowDecide>(async () => {
      throw new Error('laya-serve answered 503')
    })

    const results = await runWorkflowOnItems(
      workflow({ graph: decisionGraph() }),
      [item()],
      deps({ store, decide, notifyFailed })
    )

    expect(results).toEqual([{
      ref: 'mail:mail-1:INBOX%2F1',
      outcome: 'failed',
      runId: 'run-1',
      error: 'laya-serve answered 503'
    }])
    expect(store.runs[0]!.outcome).toBe('failed')
    expect(store.runs[0]!.error).toBe('laya-serve answered 503')
    expect(store.evaluated).toEqual([])
    expect(store.attempts).toEqual([])
    expect(notifyFailed).not.toHaveBeenCalled()
  })

  it('records a skip when the walk reaches no action', async () => {
    const store = fakeStore()

    const results = await runWorkflowOnItems(workflow({ graph: endGraph(), mode: 'auto' }), [item()], deps({ store }))

    expect(results[0]!.outcome).toBe('skipped')
    expect(store.runs[0]!.outcome).toBe('skipped')
    expect(store.runs[0]!.actions).toEqual([])
  })

  it('evaluates a batch of items with one workflow', async () => {
    const store = fakeStore()
    const decideBatch = vi.fn<WorkflowDecideBatch>(async (states, questions) => states.map(() => ({
      [Object.keys(questions)[0]!]: { yes: 0.95, confidence: 0.9 }
    })))

    const results = await runWorkflowOnItems(
      workflow({ graph: decisionGraph() }),
      [item('a'), item('b')],
      deps({ store, decideBatch })
    )

    expect(decideBatch).toHaveBeenCalledTimes(1)
    expect(results.map(result => result.outcome)).toEqual(['suggested', 'suggested'])
    expect(store.runs).toHaveLength(2)
  })

  it('stops before an item whose lease renewal failed', async () => {
    const store = fakeStore()
    const applier = fakeApplier()
    const beforeItem = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const results = await runWorkflowOnItems(
      workflow({ mode: 'auto' }),
      [item('a', { key: 'a' }), item('b', { key: 'b', uid: 2 })],
      deps({ store, applierFor: () => applier }),
      { beforeItem }
    )

    expect(results[0]!.outcome).toBe('applied')
    expect(results[1]).toMatchObject({ outcome: 'failed', error: MANUAL_RUN_LOST_LOCK })
    expect(applier.applied).toHaveLength(1)
    expect(store.runs).toHaveLength(1)
  })
})

describe('manual run groups', () => {
  const entries: ManualRunEntry[] = [
    { ref: 'mail:mail-1:INBOX%2F1', item: item('a', { service: 'mail-1', key: 'a' }) },
    { ref: 'mail:mail-2:INBOX%2F2', item: item('b', { service: 'mail-2', key: 'b', uid: 2 }) },
    { ref: 'mail:mail-1:INBOX%2F3', item: item('c', { service: 'mail-1', key: 'c', uid: 3 }) }
  ]

  it('applies each service group through its own applier and keeps request order', async () => {
    const store = fakeStore()
    const appliers = new Map<string, FakeApplier>([
      ['mail-1', fakeApplier()],
      ['mail-2', fakeApplier()]
    ])
    const order: string[] = []

    const results = await runManualGroups(entries, {
      renew: async () => true,
      runGroup: (group, beforeItem) => {
        order.push(group.service)
        return runWorkflowOnItems(
          workflow({ mode: 'auto' }),
          group.entries.map(entry => entry.item),
          deps({
            store,
            applierFor: (_domain, service) => {
              expect(appliers.has(service)).toBe(true)
              return appliers.get(service)!
            }
          }),
          { beforeItem }
        )
      }
    })

    expect(order).toEqual(['mail-1', 'mail-2'])
    expect(results.map(result => result.ref)).toEqual(entries.map(entry => entry.ref))
    expect(results.map(result => result.outcome)).toEqual(['applied', 'applied', 'applied'])
    expect(appliers.get('mail-1')!.applied).toHaveLength(2)
    expect(appliers.get('mail-2')!.applied).toHaveLength(1)
    expect(store.runs.map(run => run.service)).toEqual(['mail-1', 'mail-1', 'mail-2'])
  })

  it('reports the rest as failed when a renewal is lost', async () => {
    const renew = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false)

    const runGroup = vi.fn(async (group: { entries: ManualRunEntry[] }, beforeItem: () => Promise<boolean>) => {
      const results: Array<{ ref: string, outcome: 'applied' | 'failed', error?: string }> = []
      for (const [index, entry] of group.entries.entries()) {
        if (!(await beforeItem())) {
          results.push(...group.entries.slice(index).map(other => ({
            ref: other.ref,
            outcome: 'failed' as const,
            error: MANUAL_RUN_LOST_LOCK
          })))
          break
        }
        results.push({ ref: entry.ref, outcome: 'applied' })
      }
      return results
    })

    const results = await runManualGroups(entries, { renew, runGroup })

    expect(results.map(result => result.outcome)).toEqual(['applied', 'failed', 'failed'])
    expect(results[1]!.error).toBe(MANUAL_RUN_LOST_LOCK)
    expect(results[2]!.error).toBe(MANUAL_RUN_LOST_LOCK)
    expect(runGroup).toHaveBeenCalledTimes(1)
    expect(renew).toHaveBeenCalledTimes(3)
  })
})
