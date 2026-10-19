import type {
  AutomationDomain,
  AutomationItem,
  DecisionAnswer,
  DecisionQuestion,
  PlannedAction,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowPathStep
} from './types/automation'
import { CHOICE_OTHER } from './types/automation'
import { matchesConditions } from './automation'

/** A decision engine caller; the automation layer injects Laya through this */
export type WorkflowDecide = (state: string, questions: Record<string, DecisionQuestion>) => Promise<Record<string, DecisionAnswer>>

/**
 * The batch form of {@link WorkflowDecide}: the same questions are asked about many
 * states in one call (Laya collates them into one forward pass). Used by the engine
 * and the preview so a wave of items at the same decision node costs one call.
 */
export type WorkflowDecideBatch = (states: string[], questions: Record<string, DecisionQuestion>) => Promise<Array<Record<string, DecisionAnswer>>>

export interface WorkflowValidationError {
  /** The node the error belongs to, when it is node-local */
  nodeId?: string
  message: string
}

export interface WorkflowResult {
  path: WorkflowPathStep[]
  answers: Record<string, DecisionAnswer>
  actions: PlannedAction[]
}

/** One item's walk result; `error` is set when a batch decision call failed for it */
export interface WorkflowBatchResult extends WorkflowResult {
  error?: string
}

const MAIL_ACTIONS = new Set(['move-to', 'label', 'mark-read', 'star'])
const DOCUMENT_ACTIONS = new Set(['add-tag', 'set-correspondent', 'set-type'])

/** The output handles a node offers; the UI draws one handle per entry */
export function nodeOutputs(node: WorkflowNode): string[] {
  switch (node.type) {
    case 'trigger':
    case 'action':
      return ['next']
    case 'condition':
      return ['true', 'false']
    case 'decision':
      // An explicit catch-all option is a real option; the `other` output is only
      // appended when the node does not already offer one, so handles never repeat.
      return node.data.question === 'choice'
        ? [...new Set([...Object.keys(node.data.options), CHOICE_OTHER])]
        : ['yes', 'no', 'unsure']
    case 'end':
      return []
  }
}

/** The decision question a decision node asks */
export function questionForNode(node: Extract<WorkflowNode, { type: 'decision' }>): DecisionQuestion {
  if (node.data.question === 'choice') {
    return { type: 'choice', instructions: node.data.instructions, options: node.data.options }
  }
  return { type: 'yesno', instructions: node.data.instructions }
}

/** The output a decision node takes for one answer; the threshold decides `other`/`unsure` */
export function decisionOutput(data: Extract<WorkflowNode, { type: 'decision' }>['data'], answer: DecisionAnswer | undefined): string {
  if (data.question === 'choice') {
    const choice = answer?.choice
    if (choice && choice in data.options && answer!.confidence >= (data.thresholds[choice] ?? 0)) {
      return choice
    }
    return CHOICE_OTHER
  }

  const yes = answer?.yes
  if (yes === undefined) {
    return 'unsure'
  }
  if (yes >= data.thresholds.yes) {
    return 'yes'
  }
  return (1 - yes) >= data.thresholds.no ? 'no' : 'unsure'
}

function outputCount(edges: WorkflowGraph['edges'], nodeId: string, output: string): number {
  return edges.filter(edge => edge.source === nodeId && edge.sourceHandle === output).length
}

/** Whether a document action carries a real provider id rather than an unresolved placeholder */
function isPositiveId(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/**
 * Validates a graph: one trigger, unique ids, edges that reference real nodes and
 * outputs, at most one edge per output, no cycles, valid decision options and
 * thresholds, and (when the domain is known) actions that belong to it.
 */
export function validateWorkflow(graph: WorkflowGraph, domain?: AutomationDomain): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = []

  if (graph.version !== 1) {
    errors.push({ message: `Unsupported graph version ${graph.version}` })
  }

  const ids = new Set<string>()
  for (const node of graph.nodes) {
    if (ids.has(node.id)) {
      errors.push({ nodeId: node.id, message: `Duplicate node id "${node.id}"` })
    }
    ids.add(node.id)
  }

  const triggers = graph.nodes.filter(node => node.type === 'trigger')
  if (triggers.length !== 1) {
    errors.push({ message: `A workflow needs exactly one trigger, found ${triggers.length}` })
  }

  for (const node of graph.nodes) {
    if (node.type === 'decision' && node.data.question === 'choice') {
      if (!Object.keys(node.data.options).length) {
        errors.push({ nodeId: node.id, message: 'A choice decision needs at least one option' })
      }
      for (const [key, threshold] of Object.entries(node.data.thresholds)) {
        if (threshold < 0 || threshold > 1) {
          errors.push({ nodeId: node.id, message: `Threshold for "${key}" must be between 0 and 1` })
        }
      }
    }
    if (node.type === 'decision' && node.data.question === 'yesno') {
      for (const [key, threshold] of Object.entries(node.data.thresholds)) {
        if (threshold < 0 || threshold > 1) {
          errors.push({ nodeId: node.id, message: `Threshold for "${key}" must be between 0 and 1` })
        }
      }
    }
    if (node.type === 'action' && domain) {
      const allowed = domain === 'mail' ? MAIL_ACTIONS : DOCUMENT_ACTIONS
      if (!allowed.has(node.data.action.type)) {
        errors.push({ nodeId: node.id, message: `Action "${node.data.action.type}" does not belong to the ${domain} domain` })
      }
    }
    if (node.type === 'action') {
      // A template can carry a name instead of an id; an id that was not resolved
      // yet (0) is shown as an error until the user picks a real tag or type.
      const action = node.data.action
      if (action.type === 'add-tag' && !isPositiveId(action.tag)) {
        errors.push({ nodeId: node.id, message: 'The tag action needs a tag' })
      }
      if (action.type === 'set-correspondent' && !isPositiveId(action.correspondent)) {
        errors.push({ nodeId: node.id, message: 'The correspondent action needs a correspondent' })
      }
      if (action.type === 'set-type' && !isPositiveId(action.documentType)) {
        errors.push({ nodeId: node.id, message: 'The document type action needs a document type' })
      }
    }
  }

  for (const edge of graph.edges) {
    const source = graph.nodes.find(node => node.id === edge.source)
    const target = graph.nodes.find(node => node.id === edge.target)
    if (!source) {
      errors.push({ message: `Edge "${edge.id}" leaves an unknown node "${edge.source}"` })
      continue
    }
    if (!target) {
      errors.push({ message: `Edge "${edge.id}" enters an unknown node "${edge.target}"` })
      continue
    }
    if (!nodeOutputs(source).includes(edge.sourceHandle)) {
      errors.push({ message: `Edge "${edge.id}" leaves an unknown output "${edge.sourceHandle}" of "${edge.source}"` })
    }
    if (outputCount(graph.edges, edge.source, edge.sourceHandle) > 1) {
      errors.push({ message: `Output "${edge.sourceHandle}" of "${edge.source}" is connected more than once` })
    }
  }

  if (hasCycle(graph)) {
    errors.push({ message: 'The workflow contains a cycle' })
  }

  return errors
}

/** Whether following the edges from any node revisits it */
export function hasCycle(graph: WorkflowGraph): boolean {
  const adjacency = new Map<string, string[]>()
  for (const edge of graph.edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target])
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()

  function walk(id: string): boolean {
    if (visiting.has(id)) {
      return true
    }
    if (visited.has(id)) {
      return false
    }
    visiting.add(id)
    for (const next of adjacency.get(id) ?? []) {
      if (walk(next)) {
        return true
      }
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }

  return graph.nodes.some(node => walk(node.id))
}

/** A fresh workflow: a trigger feeding an end, ready to be extended */
export function createDefaultGraph(domain: AutomationDomain, mailbox = 'INBOX'): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'new-item', mailbox: domain === 'mail' ? mailbox : 'INBOX' } },
      { id: 'end', type: 'end', position: { x: 320, y: 0 }, data: {} }
    ],
    edges: [{ id: 'trigger-end', source: 'trigger', sourceHandle: 'next', target: 'end' }]
  }
}

export interface WorkflowRunOptions {
  /** Called for each decision node reached; useful for progress or per-node answers */
  onAnswer?: (nodeId: string, answer: DecisionAnswer | undefined) => void
}

interface WalkState {
  item: AutomationItem
  node: WorkflowNode | undefined
  steps: number
  done: boolean
  path: WorkflowPathStep[]
  answers: Record<string, DecisionAnswer>
  /** Answers already received, keyed by the question's shape, so a repeated question is not asked twice */
  cache: Map<string, DecisionAnswer | undefined>
  actions: PlannedAction[]
  error?: string
}

/**
 * Walks the graph for a group of items, batching decision nodes: items are advanced
 * until each reaches its next unanswered question, then one batch call answers every
 * item waiting on the same question. The per-item walk stays lazy (the path depends
 * on earlier answers); a missing edge ends an item's walk and a failed batch call
 * marks the items that were waiting on it with `error` without failing the others.
 */
export async function runWorkflowBatch(
  graph: WorkflowGraph,
  items: AutomationItem[],
  decideBatch: WorkflowDecideBatch
): Promise<WorkflowBatchResult[]> {
  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  const trigger = graph.nodes.find(node => node.type === 'trigger')
  const limit = graph.nodes.length + 1
  const states: WalkState[] = items.map(item => ({
    item,
    node: trigger,
    steps: 0,
    done: !trigger,
    path: [],
    answers: {},
    cache: new Map(),
    actions: []
  }))

  for (;;) {
    // Advance every item to its next unanswered question (or its end)
    const pending = new Map<string, { question: DecisionQuestion, waiting: Array<{ state: WalkState, nodeId: string, hash: string }> }>()

    for (const state of states) {
      while (!state.done && state.node) {
        const node = state.node
        state.steps++

        if (state.steps > limit) {
          state.error ??= 'The walk did not terminate'
          state.done = true
          break
        }

        if (node.type === 'end') {
          state.path.push({ nodeId: node.id, output: 'done' })
          state.done = true
          break
        }

        if (node.type === 'decision') {
          const question = questionForNode(node)
          const hash = JSON.stringify(question)

          if (!state.cache.has(hash)) {
            const group = pending.get(hash) ?? { question, waiting: [] }
            group.waiting.push({ state, nodeId: node.id, hash })
            pending.set(hash, group)
            break
          }

          const answer = state.cache.get(hash)
          if (answer) {
            state.answers[node.id] = answer
          }
          const output = decisionOutput(node.data, answer)
          state.path.push({ nodeId: node.id, output, answer })
          state.node = follow(graph, byId, node.id, output)
          state.done = !state.node
          continue
        }

        const output = node.type === 'condition'
          ? (matchesConditions(state.item, node.data.conditions) ? 'true' : 'false')
          : 'next'

        if (node.type === 'action') {
          state.actions.push({ nodeId: node.id, action: node.data.action })
        }

        state.path.push({ nodeId: node.id, output })
        state.node = follow(graph, byId, node.id, output)
        state.done = !state.node
      }
    }

    if (!pending.size) {
      break
    }

    // One batch call per question per wave; sequential so several nodes do not
    // overload the single-worker inference server
    for (const group of pending.values()) {
      const questions = { [group.waiting[0]!.hash]: group.question }
      const batchStates = group.waiting.map(entry => entry.state.item.state)
      let results: Array<Record<string, DecisionAnswer>> | undefined
      let failure: unknown

      try {
        results = await decideBatch(batchStates, questions)
      } catch (error) {
        failure = error
      }

      group.waiting.forEach((entry, index) => {
        if (failure !== undefined) {
          entry.state.error ??= failure instanceof Error ? failure.message : String(failure)
          entry.state.done = true
          return
        }
        entry.state.cache.set(entry.hash, results?.[index]?.[entry.hash])
      })
    }
  }

  return states.map(state => ({ path: state.path, answers: state.answers, actions: state.actions, error: state.error }))
}

function follow(graph: WorkflowGraph, byId: Map<string, WorkflowNode>, nodeId: string, output: string): WorkflowNode | undefined {
  const edge = graph.edges.find(candidate => candidate.source === nodeId && candidate.sourceHandle === output)
  return edge ? byId.get(edge.target) : undefined
}

/**
 * Walks the graph once for one item. Thin wrapper over {@link runWorkflowBatch} so
 * there is one walk implementation; a batch failure is thrown, not returned.
 */
export async function runWorkflow(
  graph: WorkflowGraph,
  item: AutomationItem,
  decide: WorkflowDecide,
  options: WorkflowRunOptions = {}
): Promise<WorkflowResult> {
  const [result] = await runWorkflowBatch(graph, [item], async (states, questions) => [await decide(states[0]!, questions)])
  for (const step of result?.path ?? []) {
    options.onAnswer?.(step.nodeId, step.answer)
  }
  if (result?.error) {
    throw new Error(result.error)
  }
  return { path: result?.path ?? [], answers: result?.answers ?? {}, actions: result?.actions ?? [] }
}

/** Asks every decision node of the graph about one text, in one batch call */
export async function runDecisionNodesBatch(
  graph: WorkflowGraph,
  text: string,
  decideBatch: WorkflowDecideBatch
): Promise<Record<string, DecisionAnswer>> {
  const questions: Record<string, DecisionQuestion> = {}
  for (const node of graph.nodes) {
    if (node.type === 'decision') {
      questions[node.id] = questionForNode(node)
    }
  }
  if (!Object.keys(questions).length) {
    return {}
  }

  const [answers] = await decideBatch([text], questions)
  return answers ?? {}
}

/** Asks every decision node of the graph about one text, without walking edges */
export async function runDecisionNodes(
  graph: WorkflowGraph,
  text: string,
  decide: WorkflowDecide
): Promise<Record<string, DecisionAnswer>> {
  return await runDecisionNodesBatch(graph, text, async (states, questions) => [await decide(states[0]!, questions)])
}

/** All action nodes of a graph, for a quick summary */
export function graphActions(graph: WorkflowGraph): PlannedAction[] {
  return graph.nodes
    .filter((node): node is Extract<WorkflowNode, { type: 'action' }> => node.type === 'action')
    .map(node => ({ nodeId: node.id, action: node.data.action }))
}

export type { WorkflowNodeType }
