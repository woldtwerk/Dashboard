import { describe, expect, it } from 'vitest'
import type {
  AutomationItem,
  AutomationRun,
  AutomationWorkflow,
  WorkflowNode,
  WorkflowPathStep
} from '../../automation/shared/types/automation'
import { layaTrainingRows, splitOf } from '../server/laya/training'

type DecisionSpec
  = | { id: string, question: 'choice', options?: Record<string, string> }
    | { id: string, question: 'yesno' }

function workflow(decisions: DecisionSpec[], id = 'wf'): AutomationWorkflow {
  const nodes: WorkflowNode[] = [
    { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
    ...decisions.map((decision, index): WorkflowNode => {
      const position = { x: 100 * (index + 1), y: 0 }
      if (decision.question === 'choice') {
        return {
          id: decision.id,
          type: 'decision',
          position,
          data: {
            question: 'choice',
            instructions: `Pick ${decision.id}`,
            options: decision.options ?? { invoice: 'An invoice', receipt: 'A receipt' },
            thresholds: {}
          }
        }
      }
      return {
        id: decision.id,
        type: 'decision',
        position,
        data: {
          question: 'yesno',
          instructions: `Ask ${decision.id}`,
          thresholds: { yes: 0.8, no: 0.8 }
        }
      }
    }),
    { id: 'end', type: 'end', position: { x: 1000, y: 0 }, data: {} }
  ]

  return {
    id,
    name: 'Sort mail',
    domain: 'mail',
    service: null,
    enabled: true,
    mode: 'suggest',
    position: 0,
    graph: { version: 1, nodes, edges: [] },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function item(key: string): AutomationItem {
  return {
    domain: 'mail',
    service: 'svc',
    key,
    mailbox: 'INBOX',
    uid: 1,
    fields: {},
    state: `From: a@b.c\nSubject: ${key}`,
    title: key
  }
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  const itemKey = overrides.itemKey ?? 'mail:svc:INBOX/1'
  return {
    id: 'run-1',
    workflow: 'wf',
    workflowName: 'Sort mail',
    domain: 'mail',
    service: 'svc',
    itemKey,
    item: item(itemKey),
    path: [],
    answers: {},
    outcome: 'skipped',
    actions: [],
    applied: [],
    at: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function step(nodeId: string, output: string, source: WorkflowPathStep['source'] = 'engine'): WorkflowPathStep {
  return { nodeId, output, source }
}

const choice = workflow([{ id: 'kind', question: 'choice' }])
const yesno = workflow([{ id: 'urgent', question: 'yesno' }])

describe('layaTrainingRows', () => {
  it('labels a human answer as the expected output', () => {
    const { rows, stats } = layaTrainingRows(
      [run({ feedback: 'answered', path: [step('kind', 'invoice', 'human')] })],
      [choice]
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.expected).toEqual({ 'wf:kind': 'invoice' })
    expect(rows[0]!.questions).toEqual({
      'wf:kind': {
        type: 'choice',
        instructions: 'Pick kind',
        criteria: { invoice: 'An invoice', receipt: 'A receipt' }
      }
    })
    expect(rows[0]!.meta).toEqual({ run: 'run-1', workflow: 'wf', node: 'kind', source: 'human' })
    expect(stats.labels).toEqual({ human: 1, confirmed: 0, rejected: 0, ai: 0 })
  })

  it('confirms every sure decision of an accepted run', () => {
    const { rows, stats } = layaTrainingRows(
      [run({ feedback: 'accepted', path: [step('kind', 'invoice')] })],
      [choice]
    )

    expect(rows[0]!.expected).toEqual({ 'wf:kind': 'invoice' })
    expect(rows[0]!.meta.source).toBe('confirmed')
    expect(stats.labels.confirmed).toBe(1)
  })

  it('keeps several confirmed questions of one run in one row', () => {
    const twoDecisions = workflow([{ id: 'kind', question: 'choice' }, { id: 'urgent', question: 'yesno' }])
    const { rows, stats } = layaTrainingRows(
      [run({ feedback: 'accepted', path: [step('kind', 'receipt'), step('urgent', 'yes')] })],
      [twoDecisions]
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.expected).toEqual({ 'wf:kind': 'receipt', 'wf:urgent': true })
    expect(Object.keys(rows[0]!.questions)).toEqual(['wf:kind', 'wf:urgent'])
    expect(stats.labels.confirmed).toBe(2)
  })

  it('does not label an unsure output', () => {
    const { rows, stats } = layaTrainingRows(
      [run({ feedback: 'accepted', path: [step('kind', 'other')] })],
      [choice]
    )

    expect(rows).toHaveLength(0)
    expect(stats.skipped['output-gone']).toBe(1)
    expect(stats.labels.confirmed).toBe(0)
  })

  it('labels a rejected single-decision run with a gold distribution', () => {
    const options = { invoice: 'An invoice', receipt: 'A receipt', other: 'Anything else' }
    const { rows, stats } = layaTrainingRows(
      [run({ feedback: 'rejected', path: [step('kind', 'invoice')] })],
      [workflow([{ id: 'kind', question: 'choice', options }])]
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.expected).toBeUndefined()
    expect(rows[0]!.gold).toEqual({
      'wf:kind': { probabilities: { receipt: 0.5, other: 0.5 } }
    })
    expect(rows[0]!.meta.source).toBe('rejected')
    expect(stats.labels.rejected).toBe(1)
  })

  it('skips a rejected run with several decision steps', () => {
    const twoDecisions = workflow([{ id: 'kind', question: 'choice' }, { id: 'urgent', question: 'yesno' }])
    const { rows, stats } = layaTrainingRows(
      [run({ feedback: 'rejected', path: [step('kind', 'invoice'), step('urgent', 'yes')] })],
      [twoDecisions]
    )

    expect(rows).toHaveLength(0)
    expect(stats.skipped['rejected-multi-node']).toBe(1)
    expect(stats.labels.rejected).toBe(0)
  })

  it('writes a yes/no expected answer as a boolean', () => {
    const { rows } = layaTrainingRows(
      [
        run({ id: 'run-yes', itemKey: 'mail:svc:INBOX/1', feedback: 'answered', path: [step('urgent', 'yes', 'human')] }),
        run({ id: 'run-no', itemKey: 'mail:svc:INBOX/2', feedback: 'answered', path: [step('urgent', 'no', 'human')] })
      ],
      [yesno]
    )

    expect(rows.map(row => row.expected)).toEqual(expect.arrayContaining([
      { 'wf:urgent': true },
      { 'wf:urgent': false }
    ]))
  })

  it('writes a rejected yes/no answer as the opposite gold target', () => {
    const { rows } = layaTrainingRows(
      [
        run({ id: 'run-yes', itemKey: 'mail:svc:INBOX/1', feedback: 'rejected', path: [step('urgent', 'yes')] }),
        run({ id: 'run-no', itemKey: 'mail:svc:INBOX/2', feedback: 'rejected', path: [step('urgent', 'no')] })
      ],
      [yesno]
    )

    expect(rows.map(row => row.gold)).toEqual(expect.arrayContaining([
      { 'wf:urgent': { probabilities: { true: 0, false: 1 } } },
      { 'wf:urgent': { probabilities: { true: 1, false: 0 } } }
    ]))
  })

  it('drops the catch-all `other` unless the node declares it', () => {
    const explicit = workflow([{
      id: 'kind',
      question: 'choice',
      options: { invoice: 'An invoice', receipt: 'A receipt', other: 'Anything else' }
    }])

    const declared = layaTrainingRows(
      [run({ feedback: 'answered', path: [step('kind', 'other', 'human')] })],
      [explicit]
    )
    expect(declared.rows[0]!.expected).toEqual({ 'wf:kind': 'other' })

    const implicit = layaTrainingRows(
      [run({ feedback: 'answered', path: [step('kind', 'other', 'human')] })],
      [choice]
    )
    expect(implicit.rows).toHaveLength(0)
    expect(implicit.stats.skipped['output-gone']).toBe(1)
  })

  it('skips a label whose node is gone', () => {
    const { rows, stats } = layaTrainingRows(
      [run({ feedback: 'accepted', path: [step('gone', 'invoice')] })],
      [choice]
    )

    expect(rows).toHaveLength(0)
    expect(stats.skipped['node-gone']).toBe(1)
  })

  it('skips a label whose workflow is gone', () => {
    const { rows, stats } = layaTrainingRows(
      [run({ feedback: 'accepted', path: [step('kind', 'invoice')] })],
      []
    )

    expect(rows).toHaveLength(0)
    expect(stats.skipped['workflow-gone']).toBe(1)
  })

  it('skips a rejected choice that has no alternative', () => {
    const onlyOption = workflow([{ id: 'kind', question: 'choice', options: { invoice: 'An invoice' } }])
    const { rows, stats } = layaTrainingRows(
      [run({ feedback: 'rejected', path: [step('kind', 'invoice')] })],
      [onlyOption]
    )

    expect(rows).toHaveLength(0)
    expect(stats.skipped['no-alternative']).toBe(1)
  })

  it('keeps only the newest run per item and workflow', () => {
    const { rows, stats } = layaTrainingRows(
      [
        run({ id: 'old', feedback: 'accepted', path: [step('kind', 'invoice')], at: '2026-01-01T00:00:00.000Z' }),
        run({ id: 'new', feedback: 'accepted', path: [step('kind', 'receipt')], at: '2026-02-01T00:00:00.000Z' })
      ],
      [choice]
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.meta.run).toBe('new')
    expect(rows[0]!.expected).toEqual({ 'wf:kind': 'receipt' })
    expect(stats.labels.confirmed).toBe(1)
  })

  it('labels a sure AI answer only when requested', () => {
    const ai = run({ path: [step('kind', 'invoice', 'ai')] })

    const off = layaTrainingRows([ai], [choice])
    expect(off.rows).toHaveLength(0)
    expect(off.stats.labels.ai).toBe(0)

    const on = layaTrainingRows([ai], [choice], { ai: true })
    expect(on.rows[0]!.expected).toEqual({ 'wf:kind': 'invoice' })
    expect(on.rows[0]!.meta.source).toBe('ai')
    expect(on.stats.labels.ai).toBe(1)
  })

  it('lets a human answer win over an AI answer', () => {
    const { rows, stats } = layaTrainingRows(
      [run({ path: [step('kind', 'invoice', 'human')] })],
      [choice],
      { ai: true }
    )

    expect(rows[0]!.meta.source).toBe('human')
    expect(stats.labels).toEqual({ human: 1, confirmed: 0, rejected: 0, ai: 0 })
  })

  it('lets a human answer win over a confirmation', () => {
    const { rows, stats } = layaTrainingRows(
      [run({ feedback: 'accepted', path: [step('kind', 'invoice', 'human')] })],
      [choice]
    )

    expect(rows[0]!.meta.source).toBe('human')
    expect(stats.labels).toEqual({ human: 1, confirmed: 0, rejected: 0, ai: 0 })
  })

  it('confirms an AI answer of an accepted run instead of counting it as ai', () => {
    const { rows, stats } = layaTrainingRows(
      [run({ feedback: 'accepted', path: [step('kind', 'invoice', 'ai')] })],
      [choice],
      { ai: true }
    )

    expect(rows[0]!.meta.source).toBe('confirmed')
    expect(stats.labels).toEqual({ human: 0, confirmed: 1, rejected: 0, ai: 0 })
  })

  it('rejects an AI answer of a rejected single-decision run', () => {
    const { rows, stats } = layaTrainingRows(
      [run({ feedback: 'rejected', path: [step('kind', 'invoice', 'ai')] })],
      [choice],
      { ai: true }
    )

    expect(rows[0]!.meta.source).toBe('rejected')
    expect(stats.labels).toEqual({ human: 0, confirmed: 0, rejected: 1, ai: 0 })
  })
})

describe('splitOf', () => {
  it('is train when the eval share is zero', () => {
    expect(splitOf('anything', 0)).toBe('train')
  })

  it('is deterministic and uses both sides', () => {
    const keys = Array.from({ length: 200 }, (_, index) => `mail:svc:INBOX/${index}`)
    const first = keys.map(key => splitOf(key, 0.3))
    const second = keys.map(key => splitOf(key, 0.3))

    expect(second).toEqual(first)
    expect(new Set(first)).toEqual(new Set(['train', 'eval']))
  })

  it('keeps an item on the same side across calls and shares', () => {
    const key = 'mail:svc:INBOX/42'
    const split = splitOf(key, 0.25)
    expect(splitOf(key, 0.25)).toBe(split)
    expect(splitOf(key, 0)).toBe('train')
  })
})
