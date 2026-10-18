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

/** A decision engine caller; the automaiton layer injects Laya through this */
export type WorkflowDecide = (state: string, questions: Record<string, DecisionQuestion>) => Promise<Record<string, DecisionAnswer>>

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
      return node.data.question === 'choice'
        ? [...Object.keys(node.data.options), CHOICE_OTHER]
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

/**
 * Walks the graph once for one item. Decision nodes are asked lazily (the path
 * depends on earlier answers) and answers are cached by question, so asking the
 * same question twice costs one call. A missing edge ends the walk.
 */
export async function runWorkflow(
  graph: WorkflowGraph,
  item: AutomationItem,
  decide: WorkflowDecide,
  options: WorkflowRunOptions = {}
): Promise<WorkflowResult> {
  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  const cache = new Map<string, DecisionAnswer | undefined>()
  const path: WorkflowPathStep[] = []
  const answers: Record<string, DecisionAnswer> = {}
  const actions: PlannedAction[] = []

  let node: WorkflowNode | undefined = graph.nodes.find(candidate => candidate.type === 'trigger')

  for (let step = 0; node && step <= graph.nodes.length; step++) {
    if (node.type === 'end') {
      path.push({ nodeId: node.id, output: 'done' })
      break
    }

    let output: string
    let answer: DecisionAnswer | undefined

    if (node.type === 'trigger') {
      output = 'next'
    } else if (node.type === 'condition') {
      output = matchesConditions(item, node.data.conditions) ? 'true' : 'false'
    } else if (node.type === 'action') {
      actions.push({ nodeId: node.id, action: node.data.action })
      output = 'next'
    } else {
      const question = questionForNode(node)
      const hash = JSON.stringify(question)
      if (!cache.has(hash)) {
        const result = await decide(item.state, { [hash]: question })
        cache.set(hash, result[hash])
      }
      answer = cache.get(hash)
      if (answer) {
        answers[node.id] = answer
      }
      options.onAnswer?.(node.id, answer)
      output = decisionOutput(node.data, answer)
    }

    path.push({ nodeId: node.id, output, answer })
    const edge = graph.edges.find(candidate => candidate.source === node!.id && candidate.sourceHandle === output)
    node = edge ? byId.get(edge.target) : undefined
  }

  return { path, answers, actions }
}

/** Asks every decision node of the graph about one text, without walking edges */
export async function runDecisionNodes(
  graph: WorkflowGraph,
  text: string,
  decide: WorkflowDecide
): Promise<Record<string, DecisionAnswer>> {
  const answers: Record<string, DecisionAnswer> = {}

  for (const node of graph.nodes) {
    if (node.type !== 'decision') {
      continue
    }
    const question = questionForNode(node)
    const result = await decide(text, { [node.id]: question })
    if (result[node.id]) {
      answers[node.id] = result[node.id]!
    }
  }

  return answers
}

/** All action nodes of a graph, for a quick summary */
export function graphActions(graph: WorkflowGraph): PlannedAction[] {
  return graph.nodes
    .filter((node): node is Extract<WorkflowNode, { type: 'action' }> => node.type === 'action')
    .map(node => ({ nodeId: node.id, action: node.data.action }))
}

export type { WorkflowNodeType }
