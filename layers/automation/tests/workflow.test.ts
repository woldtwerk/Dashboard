import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultGraph,
  decisionOutput,
  graphActions,
  hasCycle,
  nodeOutputs,
  runDecisionNodes,
  runWorkflow,
  runWorkflowBatch,
  validateWorkflow
} from '../shared/workflow'
import type { WorkflowDecide } from '../shared/workflow'
import type { AutomationItem, DecisionAnswer, WorkflowGraph } from '../shared/types/automation'

function item(fields: Record<string, string> = {}, state = 'state'): AutomationItem {
  return {
    domain: 'mail',
    service: 'mail-1',
    key: 'INBOX|1|m1',
    mailbox: 'INBOX',
    uid: 1,
    fields,
    state,
    title: 'Invoice'
  }
}

/** A decide that answers the single question it is asked with a fixed answer */
function decideWith(answer: DecisionAnswer): WorkflowDecide {
  return async (_state, questions) => ({ [Object.keys(questions)[0]!]: answer })
}

function choiceGraph(threshold = 0.8): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
      {
        id: 'kind',
        type: 'decision',
        position: { x: 0, y: 100 },
        data: {
          question: 'choice',
          instructions: 'What kind of mail is this?',
          options: { invoice: 'An invoice', receipt: 'A receipt' },
          thresholds: { invoice: threshold, receipt: threshold }
        }
      },
      { id: 'star', type: 'action', position: { x: 0, y: 200 }, data: { action: { type: 'star' } } },
      { id: 'end', type: 'end', position: { x: 200, y: 200 }, data: {} }
    ],
    edges: [
      { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'kind' },
      { id: 'e2', source: 'kind', sourceHandle: 'invoice', target: 'star' },
      { id: 'e3', source: 'kind', sourceHandle: 'other', target: 'end' },
      { id: 'e4', source: 'star', sourceHandle: 'next', target: 'end' }
    ]
  }
}

function yesnoGraph(thresholds = { yes: 0.85, no: 0.85 }): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
      {
        id: 'urgent',
        type: 'decision',
        position: { x: 0, y: 100 },
        data: { question: 'yesno', instructions: 'Is this urgent?', thresholds }
      },
      { id: 'end', type: 'end', position: { x: 200, y: 100 }, data: {} }
    ],
    edges: [{ id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'urgent' }]
  }
}

describe('nodeOutputs', () => {
  it('names a choice\'s outputs after the options plus other', () => {
    const node = choiceGraph().nodes.find(candidate => candidate.id === 'kind')!
    expect(nodeOutputs(node)).toEqual(['invoice', 'receipt', 'other'])
  })

  it('does not repeat the other output when the node offers it as an option', () => {
    const graph = choiceGraph()
    const node = graph.nodes.find(candidate => candidate.id === 'kind')!
    if (node.type === 'decision' && node.data.question === 'choice') {
      node.data.options.other = 'Anything else'
    }
    expect(nodeOutputs(node)).toEqual(['invoice', 'receipt', 'other'])
  })

  it('names a yes/no\'s outputs', () => {
    const node = yesnoGraph().nodes.find(candidate => candidate.id === 'urgent')!
    expect(nodeOutputs(node)).toEqual(['yes', 'no', 'unsure'])
  })
})

describe('decisionOutput', () => {
  function choiceData() {
    const node = choiceGraph().nodes.find(candidate => candidate.id === 'kind')!
    if (node.type !== 'decision') {
      throw new Error('expected a decision node')
    }
    return node.data
  }

  function yesnoData() {
    const node = yesnoGraph().nodes.find(candidate => candidate.id === 'urgent')!
    if (node.type !== 'decision') {
      throw new Error('expected a decision node')
    }
    return node.data
  }

  it('takes the option at or above its threshold', () => {
    expect(decisionOutput(choiceData(), { choice: 'invoice', confidence: 0.8 })).toBe('invoice')
  })

  it('falls to other below the threshold or without an answer', () => {
    expect(decisionOutput(choiceData(), { choice: 'invoice', confidence: 0.79 })).toBe('other')
    expect(decisionOutput(choiceData(), undefined)).toBe('other')
  })

  it('branches a yes/no answer by its thresholds', () => {
    expect(decisionOutput(yesnoData(), { yes: 0.9, confidence: 0.9 })).toBe('yes')
    expect(decisionOutput(yesnoData(), { yes: 0.1, confidence: 0.9 })).toBe('no')
    expect(decisionOutput(yesnoData(), { yes: 0.5, confidence: 0.5 })).toBe('unsure')
  })
})

describe('runWorkflow', () => {
  it('walks the matching choice branch and plans its action', async () => {
    const result = await runWorkflow(choiceGraph(), item(), decideWith({ choice: 'invoice', confidence: 0.9 }))

    expect(result.path.map(step => `${step.nodeId}:${step.output}`)).toEqual(['trigger:next', 'kind:invoice', 'star:next', 'end:done'])
    expect(result.actions).toEqual([{ nodeId: 'star', action: { type: 'star' } }])
    expect(result.answers.kind).toEqual({ choice: 'invoice', confidence: 0.9 })
  })

  it('takes the other branch below the threshold', async () => {
    const result = await runWorkflow(choiceGraph(), item(), decideWith({ choice: 'invoice', confidence: 0.5 }))
    expect(result.path.map(step => step.output)).toEqual(['next', 'other', 'done'])
    expect(result.actions).toEqual([])
  })

  it('follows a condition into its false path', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
        {
          id: 'cond',
          type: 'condition',
          position: { x: 0, y: 50 },
          data: { conditions: { combine: 'all', conditions: [{ field: 'subject', op: 'contains', value: 'invoice' }] } }
        },
        { id: 'star', type: 'action', position: { x: 0, y: 100 }, data: { action: { type: 'star' } } },
        { id: 'end', type: 'end', position: { x: 200, y: 100 }, data: {} }
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'cond' },
        { id: 'e2', source: 'cond', sourceHandle: 'true', target: 'star' },
        { id: 'e3', source: 'cond', sourceHandle: 'false', target: 'end' },
        { id: 'e4', source: 'star', sourceHandle: 'next', target: 'end' }
      ]
    }

    const result = await runWorkflow(graph, item({ subject: 'Newsletter' }), decideWith({ yes: 1, confidence: 1 }))
    expect(result.path.map(step => step.output)).toEqual(['next', 'false', 'done'])
    expect(result.actions).toEqual([])
  })

  it('chains several actions in order', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
        { id: 'move', type: 'action', position: { x: 0, y: 50 }, data: { action: { type: 'move-to', folder: 'Archive' } } },
        { id: 'read', type: 'action', position: { x: 0, y: 100 }, data: { action: { type: 'mark-read' } } },
        { id: 'end', type: 'end', position: { x: 200, y: 100 }, data: {} }
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'move' },
        { id: 'e2', source: 'move', sourceHandle: 'next', target: 'read' },
        { id: 'e3', source: 'read', sourceHandle: 'next', target: 'end' }
      ]
    }

    const result = await runWorkflow(graph, item(), decideWith({ yes: 1, confidence: 1 }))
    expect(result.actions.map(planned => planned.action.type)).toEqual(['move-to', 'mark-read'])
  })

  it('stops at a node whose output has no edge', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
        { id: 'star', type: 'action', position: { x: 0, y: 50 }, data: { action: { type: 'star' } } }
      ],
      edges: [{ id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'star' }]
    }

    const result = await runWorkflow(graph, item(), decideWith({ yes: 1, confidence: 1 }))
    expect(result.path.map(step => step.nodeId)).toEqual(['trigger', 'star'])
    expect(result.actions).toHaveLength(1)
  })

  it('asks the same question only once', async () => {
    const decide = vi.fn(decideWith({ yes: 1, confidence: 1 }))
    const graph = yesnoGraph()
    graph.nodes.push({ id: 'star', type: 'action', position: { x: 0, y: 200 }, data: { action: { type: 'star' } } })
    graph.edges.push({ id: 'e2', source: 'urgent', sourceHandle: 'yes', target: 'star' })
    graph.edges.push({ id: 'e3', source: 'star', sourceHandle: 'next', target: 'end' })

    await runWorkflow(graph, item(), decide)
    expect(decide).toHaveBeenCalledTimes(1)
  })
})

describe('runDecisionNodes', () => {
  it('asks every decision node about the text', async () => {
    const decide = vi.fn(decideWith({ choice: 'invoice', confidence: 0.9 }))
    const answers = await runDecisionNodes(choiceGraph(), 'some text', decide)

    expect(decide).toHaveBeenCalledTimes(1)
    expect(answers.kind).toEqual({ choice: 'invoice', confidence: 0.9 })
  })
})

describe('runWorkflowBatch', () => {
  /** Items with distinct keys, one per state */
  function items(count: number): AutomationItem[] {
    return Array.from({ length: count }, (_, index) => ({
      ...item({ subject: 'Invoice' }, `state ${index}`),
      key: `INBOX|${index}|m${index}`,
      uid: index
    }))
  }

  it('asks one batch call for the whole wave at a decision node', async () => {
    const calls: Array<{ states: string[], questions: Record<string, unknown> }> = []
    const decideBatch = vi.fn(async (states: string[], questions: Record<string, unknown>) => {
      calls.push({ states, questions })
      return states.map(() => ({ [Object.keys(questions)[0]!]: { choice: 'invoice', confidence: 0.9 } }))
    })

    const results = await runWorkflowBatch(choiceGraph(), items(3), decideBatch)

    expect(decideBatch).toHaveBeenCalledTimes(1)
    expect(calls[0]!.states).toEqual(['state 0', 'state 1', 'state 2'])
    expect(results.every(result => result.actions.length === 1)).toBe(true)
    expect(results.every(result => result.path.some(step => step.nodeId === 'kind'))).toBe(true)
  })

  it('walks two decision nodes in two waves', async () => {
    const graph = choiceGraph()
    // A second decision node after the first action's path
    graph.nodes.push({
      id: 'second',
      type: 'decision',
      position: { x: 0, y: 260 },
      data: { question: 'yesno', instructions: 'Urgent?', thresholds: { yes: 0.8, no: 0.8 } }
    })
    graph.edges = graph.edges.map(edge => edge.id === 'e4' ? { ...edge, target: 'second' } : edge)
    graph.edges.push({ id: 'e5', source: 'second', sourceHandle: 'yes', target: 'end' })

    const decideBatch = vi.fn(async (states: string[], questions: Record<string, unknown>) => {
      const key = Object.keys(questions)[0]!
      const isChoice = (questions[key] as { type: string }).type === 'choice'
      return states.map(() => ({ [key]: isChoice ? { choice: 'invoice', confidence: 0.9 } : { yes: 0.9, confidence: 0.9 } }))
    })

    await runWorkflowBatch(graph, items(2), decideBatch)

    // Wave 1 answers `kind` for both items, wave 2 answers `second` for both
    expect(decideBatch).toHaveBeenCalledTimes(2)
  })

  it('isolates a failed batch call to the items waiting on that node', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } },
        { id: 'cond', type: 'condition', position: { x: 0, y: 50 }, data: { conditions: { combine: 'all', conditions: [{ field: 'subject', op: 'contains', value: 'x' }] } } },
        { id: 'a', type: 'decision', position: { x: 0, y: 100 }, data: { question: 'yesno', instructions: 'a?', thresholds: { yes: 0.5, no: 0.5 } } },
        { id: 'b', type: 'decision', position: { x: 200, y: 100 }, data: { question: 'yesno', instructions: 'b?', thresholds: { yes: 0.5, no: 0.5 } } },
        { id: 'end', type: 'end', position: { x: 0, y: 200 }, data: {} }
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourceHandle: 'next', target: 'cond' },
        { id: 'e2', source: 'cond', sourceHandle: 'true', target: 'a' },
        { id: 'e3', source: 'cond', sourceHandle: 'false', target: 'b' },
        { id: 'e4', source: 'a', sourceHandle: 'yes', target: 'end' },
        { id: 'e5', source: 'b', sourceHandle: 'yes', target: 'end' }
      ]
    }

    const decideBatch = vi.fn(async (states: string[], questions: Record<string, unknown>) => {
      const key = Object.keys(questions)[0]!
      if ((questions[key] as { instructions: string }).instructions === 'a?') {
        throw new Error('engine down')
      }
      return states.map(() => ({ [key]: { yes: 0.9, confidence: 0.9 } }))
    })

    const results = await runWorkflowBatch(graph, [item({ subject: 'x' }, 'a-state'), item({ subject: 'y' }, 'b-state')], decideBatch)

    expect(results[0]!.error).toBe('engine down')
    expect(results[1]!.error).toBeUndefined()
  })
})

describe('graphActions', () => {
  it('lists every action node', () => {
    expect(graphActions(choiceGraph())).toEqual([{ nodeId: 'star', action: { type: 'star' } }])
  })
})

describe('validateWorkflow', () => {
  it('accepts a well-formed graph', () => {
    expect(validateWorkflow(choiceGraph(), 'mail')).toEqual([])
  })

  it('requires exactly one trigger', () => {
    const graph = choiceGraph()
    graph.nodes.push({ id: 'trigger2', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: 'INBOX' } })
    expect(validateWorkflow(graph).some(error => error.message.includes('exactly one trigger'))).toBe(true)
  })

  it('rejects a cycle', () => {
    const graph = choiceGraph()
    graph.edges.push({ id: 'loop', source: 'end', sourceHandle: 'back', target: 'kind' })
    expect(validateWorkflow(graph).some(error => error.message.includes('cycle'))).toBe(true)
    expect(hasCycle(graph)).toBe(true)
  })

  it('rejects an unknown output handle', () => {
    const graph = choiceGraph()
    graph.edges[1]!.sourceHandle = 'nope'
    expect(validateWorkflow(graph).some(error => error.message.includes('unknown output'))).toBe(true)
  })

  it('rejects two edges from one output', () => {
    const graph = choiceGraph()
    graph.edges.push({ id: 'dup', source: 'kind', sourceHandle: 'invoice', target: 'end' })
    expect(validateWorkflow(graph).some(error => error.message.includes('more than once'))).toBe(true)
  })

  it('rejects a document action in a mail graph', () => {
    const graph = choiceGraph()
    graph.nodes.find(node => node.id === 'star')!.data = { action: { type: 'add-tag', tag: 1 } } as never
    expect(validateWorkflow(graph, 'mail').some(error => error.message.includes('does not belong'))).toBe(true)
    expect(validateWorkflow(graph, 'documents')).toEqual([])
  })

  it('rejects a choice without options and an out-of-range threshold', () => {
    const graph = choiceGraph()
    const decision = graph.nodes.find(node => node.type === 'decision')
    if (decision && decision.type === 'decision' && decision.data.question === 'choice') {
      decision.data.options = {}
      decision.data.thresholds = { invoice: 1.5 }
    }
    expect(validateWorkflow(graph).some(error => error.message.includes('at least one option'))).toBe(true)
    expect(validateWorkflow(graph).some(error => error.message.includes('between 0 and 1'))).toBe(true)
  })
})

describe('createDefaultGraph', () => {
  it('is a valid trigger feeding an end', () => {
    expect(validateWorkflow(createDefaultGraph('mail'), 'mail')).toEqual([])
  })
})
