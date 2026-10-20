import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultGraph,
  decisionOutput,
  decisionVerdict,
  FallbackUnavailableError,
  graphActions,
  hasCycle,
  nodeOutputs,
  runDecisionNodes,
  runWorkflow,
  runWorkflowBatch,
  validateWorkflow
} from '../shared/workflow'
import type { WorkflowDecide, WorkflowFallbackDecideBatch } from '../shared/workflow'
import type { AutomationItem, DecisionAnswer, DecisionAttempt, DecisionFallback, WorkflowGraph } from '../shared/types/automation'

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

describe('decisionVerdict', () => {
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

  it('is sure at or above the option threshold', () => {
    expect(decisionVerdict(choiceData(), { choice: 'invoice', confidence: 0.8 })).toEqual({ output: 'invoice', sure: true })
    expect(decisionVerdict(choiceData(), { choice: 'invoice', confidence: 0.79 })).toEqual({ output: 'other', sure: false })
  })

  it('is unsure without an answer or for an unknown option', () => {
    expect(decisionVerdict(choiceData(), undefined)).toEqual({ output: 'other', sure: false })
    expect(decisionVerdict(choiceData(), { choice: 'nope', confidence: 1 })).toEqual({ output: 'other', sure: false })
  })

  it('branches a yes/no answer and marks unsure in between', () => {
    expect(decisionVerdict(yesnoData(), { yes: 0.9, confidence: 0.9 })).toEqual({ output: 'yes', sure: true })
    expect(decisionVerdict(yesnoData(), { yes: 0.1, confidence: 0.9 })).toEqual({ output: 'no', sure: true })
    expect(decisionVerdict(yesnoData(), { yes: 0.5, confidence: 0.5 })).toEqual({ output: 'unsure', sure: false })
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

  it('reports each decision call and each item once, as soon as its walk ends', async () => {
    const graph = choiceGraph()
    // Item 1 has no subject match and skips the decision through a condition
    graph.nodes.push({
      id: 'gate',
      type: 'condition',
      position: { x: 0, y: 50 },
      data: { conditions: { combine: 'all', conditions: [{ field: 'subject', op: 'contains', value: 'invoice' }] } }
    })
    graph.edges = graph.edges.map(edge => edge.id === 'e1' ? { ...edge, target: 'gate' } : edge)
    graph.edges.push(
      { id: 'g1', source: 'gate', sourceHandle: 'true', target: 'kind' },
      { id: 'g2', source: 'gate', sourceHandle: 'false', target: 'end' }
    )

    const events: string[] = []
    const decideBatch = vi.fn(async (states: string[], questions: Record<string, unknown>) => {
      events.push('call')
      return states.map(() => ({ [Object.keys(questions)[0]!]: { choice: 'invoice', confidence: 0.9 } }))
    })
    const batch = [item({ subject: 'Invoice' }, 'a'), { ...item({ subject: 'Hello' }, 'b'), key: 'INBOX|2|m2', uid: 2 }]

    const results = await runWorkflowBatch(graph, batch, decideBatch, {
      onDecide: (nodeId, count) => events.push(`decide ${nodeId} ${count}`),
      onItemDone: (index, result) => events.push(`done ${index} ${result.actions.length}`)
    })

    // The gated item ends before the call; the asked item right after it
    expect(events).toEqual(['done 1 0', 'decide kind 1', 'call', 'done 0 1'])
    expect(results[0]!.actions).toHaveLength(1)
  })

  it('stops before the next decision call once aborted', async () => {
    const abort = new AbortController()
    const decideBatch = vi.fn(async (states: string[], questions: Record<string, unknown>) =>
      states.map(() => ({ [Object.keys(questions)[0]!]: { choice: 'invoice', confidence: 0.9 } })))
    abort.abort(new Error('stopped'))

    await expect(runWorkflowBatch(choiceGraph(), items(2), decideBatch, { signal: abort.signal })).rejects.toThrow('stopped')
    expect(decideBatch).not.toHaveBeenCalled()
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

  it('accepts generic actions in both domains', () => {
    const graph = choiceGraph()
    graph.nodes.find(node => node.id === 'star')!.data = {
      action: { type: 'extract', variable: 'code', extractor: 'login-code' }
    } as never
    expect(validateWorkflow(graph, 'mail')).toEqual([])
    expect(validateWorkflow(graph, 'documents')).toEqual([])
  })

  it('rejects an invalid extract variable name and regex', () => {
    const nameGraph = choiceGraph()
    nameGraph.nodes.find(node => node.id === 'star')!.data = {
      action: { type: 'extract', variable: 'Bad Name', extractor: 'login-code' }
    } as never
    expect(validateWorkflow(nameGraph, 'mail').some(error => error.message.includes('not a valid variable name'))).toBe(true)

    const regexGraph = choiceGraph()
    regexGraph.nodes.find(node => node.id === 'star')!.data = {
      action: { type: 'extract', variable: 'code', extractor: 'regex', pattern: '(' }
    } as never
    expect(validateWorkflow(regexGraph, 'mail').some(error => error.message.includes('not a valid regular expression'))).toBe(true)
  })

  it('rejects a notify variable that no extract node defines', () => {
    const graph = choiceGraph()
    graph.nodes.find(node => node.id === 'star')!.data = {
      action: { type: 'notify', title: 'Code {{code}}', modal: { text: '{{code}} in {{title}}' } }
    } as never

    const errors = validateWorkflow(graph, 'mail').filter(error => error.nodeId === 'star')
    expect(errors).toEqual([{ nodeId: 'star', message: '{{code}} is never extracted' }])
  })

  it('accepts a notify once an extract node defines its variable', () => {
    const graph = choiceGraph()
    graph.nodes.push({
      id: 'extract',
      type: 'action',
      position: { x: 0, y: 150 },
      data: { action: { type: 'extract', variable: 'code', extractor: 'login-code' } }
    })
    graph.nodes.find(node => node.id === 'star')!.data = {
      action: { type: 'notify', title: 'Code {{code}} from {{from}}', body: '{{workflow}} · {{subject}}' }
    } as never

    expect(validateWorkflow(graph, 'mail')).toEqual([])
  })

  it('accepts a complete save-to-drive in both domains', () => {
    const graph = choiceGraph()
    graph.nodes.find(node => node.id === 'star')!.data = {
      action: { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/Public', accept: ['video/*'], conflict: 'skip' }
    } as never

    expect(validateWorkflow(graph, 'mail')).toEqual([])
    expect(validateWorkflow(graph, 'documents')).toEqual([])
  })

  it('accepts a hand-written folder below a section root', () => {
    const graph = choiceGraph()
    graph.nodes.find(node => node.id === 'star')!.data = {
      action: { type: 'save-to-drive', service: 'drive-1', folder: 'Public/salsa' }
    } as never

    expect(validateWorkflow(graph, 'mail')).toEqual([])
  })

  it('rejects a save-to-drive without a service, with a folder the drive cannot use and with a bad media type', () => {
    const graph = choiceGraph()
    graph.nodes.find(node => node.id === 'star')!.data = {
      action: { type: 'save-to-drive', service: ' ', folder: '/trash/Public', accept: ['video'] }
    } as never

    const errors = validateWorkflow(graph, 'mail').filter(error => error.nodeId === 'star')
    expect(errors.map(error => error.message)).toEqual([
      'The save-to-drive action needs a drive service',
      'The save-to-drive folder must be a path like /my-files/Public',
      '"video" is not a media type like video/* or application/pdf'
    ])
  })

  it('rejects a save-to-drive folder with a .. segment', () => {
    const graph = choiceGraph()
    graph.nodes.find(node => node.id === 'star')!.data = {
      action: { type: 'save-to-drive', service: 'drive-1', folder: '/my-files/../etc' }
    } as never

    expect(validateWorkflow(graph, 'mail')).toEqual([
      { nodeId: 'star', message: 'The save-to-drive folder must be a path like /my-files/Public' }
    ])
  })

  it('rejects a save-to-drive without a folder', () => {
    const graph = choiceGraph()
    graph.nodes.find(node => node.id === 'star')!.data = {
      action: { type: 'save-to-drive', service: 'drive-1', folder: '' }
    } as never

    expect(validateWorkflow(graph, 'mail')).toEqual([
      { nodeId: 'star', message: 'The save-to-drive action needs a folder' }
    ])
  })
})

describe('createDefaultGraph', () => {
  it('is a valid trigger feeding an end', () => {
    expect(validateWorkflow(createDefaultGraph('mail'), 'mail')).toEqual([])
  })
})

describe('decision fallbacks', () => {
  /** The choice graph with a fallback chain on its decision node */
  function fallbackGraph(fallbacks: DecisionFallback[], threshold = 0.8): WorkflowGraph {
    const graph = choiceGraph(threshold)
    const node = graph.nodes.find(candidate => candidate.id === 'kind')!
    if (node.type === 'decision') {
      node.data.fallbacks = fallbacks
    }
    return graph
  }

  function decideWith(answer: DecisionAnswer): WorkflowDecide {
    return async (_state, questions) => ({ [Object.keys(questions)[0]!]: answer })
  }

  it('a sure primary answer skips the fallbacks entirely', async () => {
    const fallback = vi.fn<WorkflowFallbackDecideBatch>()
    const result = await runWorkflow(
      fallbackGraph([{ type: 'ai', model: '' }, { type: 'human' }]),
      item(),
      decideWith({ choice: 'invoice', confidence: 0.9 }),
      { fallback }
    )

    const step = result.path.find(candidate => candidate.nodeId === 'kind')!
    expect(step.output).toBe('invoice')
    expect(step.source).toBe('engine')
    expect(step.attempts).toBeUndefined()
    expect(result.actions).toHaveLength(1)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('an unsure primary hands over to the AI fallback and continues on its answer', async () => {
    const fallback = vi.fn<WorkflowFallbackDecideBatch>(async (entry, states, questions) =>
      states.map(() => ({ [Object.keys(questions)[0]!]: { choice: 'invoice', confidence: 0.95 } })))

    const result = await runWorkflow(
      fallbackGraph([{ type: 'ai', model: '' }]),
      item(),
      decideWith({ choice: 'invoice', confidence: 0.5 }),
      { fallback }
    )

    const step = result.path.find(candidate => candidate.nodeId === 'kind')!
    expect(step.output).toBe('invoice')
    expect(step.source).toBe('ai')
    expect(step.answer).toEqual({ choice: 'invoice', confidence: 0.95 })
    expect(step.attempts).toEqual([{ source: 'engine', output: 'other', answer: { choice: 'invoice', confidence: 0.5 } }])
    expect(result.actions).toHaveLength(1)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(fallback.mock.calls[0]![0]).toEqual({ type: 'ai', model: '' })
  })

  it('pauses with a review when the AI is unsure too and a human check follows', async () => {
    const fallback = vi.fn<WorkflowFallbackDecideBatch>(async (entry, states, questions) =>
      states.map(() => ({ [Object.keys(questions)[0]!]: { choice: 'invoice', confidence: 0.5 } })))

    const result = await runWorkflow(
      fallbackGraph([{ type: 'ai', model: '' }, { type: 'human' }]),
      item(),
      decideWith({ choice: 'invoice', confidence: 0.4 }),
      { fallback }
    )

    expect(result.review).toBe('kind')
    expect(result.actions).toEqual([])
    const step = result.path.at(-1)!
    expect(step.output).toBe('review')
    expect(step.attempts).toEqual([
      { source: 'engine', output: 'other', answer: { choice: 'invoice', confidence: 0.4 } },
      { source: 'ai', output: 'other', answer: { choice: 'invoice', confidence: 0.5 } }
    ])
    expect(step.review).toEqual({
      instructions: 'What kind of mail is this?',
      outputs: ['invoice', 'receipt', 'other'],
      options: { invoice: 'An invoice', receipt: 'A receipt' }
    })
  })

  it('records an unavailable AI fallback as an attempt and moves to the next one', async () => {
    const fallback = vi.fn<WorkflowFallbackDecideBatch>(async () => {
      throw new FallbackUnavailableError('No AI service is set up')
    })

    const result = await runWorkflow(
      fallbackGraph([{ type: 'ai', model: '' }, { type: 'human' }]),
      item(),
      decideWith({ choice: 'invoice', confidence: 0.4 }),
      { fallback }
    )

    expect(result.review).toBe('kind')
    const step = result.path.at(-1)!
    expect(step.attempts).toEqual([
      { source: 'engine', output: 'other', answer: { choice: 'invoice', confidence: 0.4 } },
      { source: 'ai', output: 'other', error: 'No AI service is set up' }
    ])
  })

  it('skips an AI fallback that cannot run when no fallback batch is provided', async () => {
    const result = await runWorkflow(
      fallbackGraph([{ type: 'ai', model: '' }]),
      item(),
      decideWith({ choice: 'invoice', confidence: 0.4 })
    )

    const step = result.path.find(candidate => candidate.nodeId === 'kind')!
    expect(step.output).toBe('other')
    expect(step.source).toBe('ai')
    expect(step.attempts).toEqual([
      { source: 'engine', output: 'other', answer: { choice: 'invoice', confidence: 0.4 } }
    ])
  })

  it('takes the other edge once the whole chain was unsure', async () => {
    const fallback = vi.fn<WorkflowFallbackDecideBatch>(async (entry, states, questions) =>
      states.map(() => ({ [Object.keys(questions)[0]!]: { choice: 'receipt', confidence: 0.4 } })))

    const result = await runWorkflow(
      fallbackGraph([{ type: 'ai', model: '' }]),
      item(),
      decideWith({ choice: 'invoice', confidence: 0.5 }),
      { fallback }
    )

    const step = result.path.find(candidate => candidate.nodeId === 'kind')!
    expect(step.output).toBe('other')
    expect(step.source).toBe('ai')
    expect(step.attempts).toEqual([{ source: 'engine', output: 'other', answer: { choice: 'invoice', confidence: 0.5 } }])
    expect(result.actions).toEqual([])
  })

  it('takes a preset without asking and resumes the walk', async () => {
    const fallback = vi.fn<WorkflowFallbackDecideBatch>()
    const decide = vi.fn(decideWith({ choice: 'invoice', confidence: 0.9 }))
    const attempts: DecisionAttempt[] = [{ source: 'engine', output: 'other', answer: { choice: 'invoice', confidence: 0.4 } }]

    const result = await runWorkflow(
      fallbackGraph([{ type: 'human' }]),
      item(),
      decide,
      { fallback, preset: { kind: { output: 'invoice', source: 'human', attempts } } }
    )

    const step = result.path.find(candidate => candidate.nodeId === 'kind')!
    expect(step.output).toBe('invoice')
    expect(step.source).toBe('human')
    expect(step.attempts).toEqual(attempts)
    expect(result.actions).toHaveLength(1)
    expect(decide).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('batches one AI fallback call per (model, question) for a wave of items', async () => {
    const calls: Array<{ fallback: DecisionFallback, states: string[] }> = []
    const fallback = vi.fn<WorkflowFallbackDecideBatch>(async (entry, states, questions) => {
      calls.push({ fallback: entry, states })
      return states.map(() => ({ [Object.keys(questions)[0]!]: { choice: 'invoice', confidence: 0.95 } }))
    })

    const batchItems = Array.from({ length: 3 }, (_, index) => ({
      ...item({ subject: 'Invoice' }, `state ${index}`),
      key: `INBOX|${index}|m${index}`,
      uid: index
    }))

    const results = await runWorkflowBatch(
      fallbackGraph([{ type: 'ai', model: 'svc:gpt' }]),
      batchItems,
      async (states, questions) => states.map(() => ({ [Object.keys(questions)[0]!]: { choice: 'invoice', confidence: 0.4 } })),
      { fallback }
    )

    expect(fallback).toHaveBeenCalledTimes(1)
    expect(calls[0]!.fallback).toEqual({ type: 'ai', model: 'svc:gpt' })
    expect(calls[0]!.states).toEqual(['state 0', 'state 1', 'state 2'])
    expect(results.every(result => result.path.some(step => step.nodeId === 'kind' && step.source === 'ai'))).toBe(true)
  })

  it('rejects a human fallback that is not the last entry', () => {
    const graph = fallbackGraph([{ type: 'human' }, { type: 'ai', model: '' }])
    expect(validateWorkflow(graph).some(error => error.message.includes('Nothing after a human check'))).toBe(true)
  })
})
