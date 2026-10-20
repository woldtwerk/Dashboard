import type {
  AutomationDomain,
  AutomationItem,
  DecisionAnswer,
  DecisionAttempt,
  DecisionFallback,
  DecisionQuestion,
  DecisionReview,
  DecisionSource,
  PlannedAction,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowPathStep
} from './types/automation'
import { CHOICE_OTHER } from './types/automation'
import { isGenericAction, matchesConditions } from './automation'
import { BUILTIN_VARIABLES, extractActionError, templateVariables } from './extractors'
import { isMimeGlob } from './mime'
import { normalizeDriveFolderInput } from '../../drive/shared/drive-path'

/** A decision engine caller; the automation layer injects Laya through this */
export type WorkflowDecide = (state: string, questions: Record<string, DecisionQuestion>) => Promise<Record<string, DecisionAnswer>>

/**
 * The batch form of {@link WorkflowDecide}: the same questions are asked about many
 * states in one call (Laya collates them into one forward pass). Used by the engine
 * and the preview so a wave of items at the same decision node costs one call.
 */
export type WorkflowDecideBatch = (states: string[], questions: Record<string, DecisionQuestion>) => Promise<Array<Record<string, DecisionAnswer>>>

/**
 * The batch form of a fallback: the same question is asked about many states in one
 * call. The automation layer builds it from the registered fallback engine, so a
 * wave of items at one AI fallback costs one call per (model, question).
 */
export type WorkflowFallbackDecideBatch = (
  fallback: Extract<DecisionFallback, { type: 'ai' }>,
  states: string[],
  questions: Record<string, DecisionQuestion>
) => Promise<Array<Record<string, DecisionAnswer>>>

/**
 * A fallback cannot answer at all (no engine registered, no AI service configured).
 * The walk records it as an attempt and moves on to the next fallback instead of
 * failing the item, which a transient provider error still does.
 */
export class FallbackUnavailableError extends Error {
  constructor(message = 'No AI fallback is configured') {
    super(message)
    this.name = 'FallbackUnavailableError'
  }
}

/** An answer a resumed walk takes without asking, e.g. the human's answer to a paused node */
export interface PresetDecision {
  output: string
  source: DecisionSource
  answer?: DecisionAnswer
  attempts?: DecisionAttempt[]
}

export interface WorkflowBatchOptions {
  /** Answers an unsure node's AI fallbacks; absent when no AI layer is installed */
  fallback?: WorkflowFallbackDecideBatch
  /** Answers keyed by node id; a preset is taken without asking (resume path) */
  preset?: Record<string, PresetDecision>
  /** Called before each batch call with the node asked and how many items wait on it */
  onDecide?: (nodeId: string, items: number) => void
  /** Called once per item as soon as its walk ends, with its index in `items` */
  onItemDone?: (index: number, result: WorkflowBatchResult) => void
  /** Checked before each batch call; an aborted walk throws the signal's reason */
  signal?: AbortSignal
}

export interface WorkflowValidationError {
  /** The node the error belongs to, when it is node-local */
  nodeId?: string
  message: string
}

export interface WorkflowResult {
  path: WorkflowPathStep[]
  answers: Record<string, DecisionAnswer>
  actions: PlannedAction[]
  /** The decision node that paused the walk for a human, when one did */
  review?: string
}

/** One item's walk result; `error` is set when a batch decision call failed for it */
export interface WorkflowBatchResult extends WorkflowResult {
  error?: string
}

/** The mail actions; the schema and the tests walk the same list */
export const MAIL_ACTIONS = new Set(['move-to', 'label', 'mark-read', 'star', 'trash'])
/** The document actions; the schema and the tests walk the same list */
export const DOCUMENT_ACTIONS = new Set(['add-tag', 'set-correspondent', 'set-type'])

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
  return decisionVerdict(data, answer).output
}

/**
 * The output a decision node takes for one answer and whether the answer was sure
 * enough for it. A choice is sure when it names a real option and reaches that
 * option's threshold; a yes/no question is sure when P(true) or P(false) reaches
 * its threshold. A sure answer's output is the option / `yes` / `no`; an unsure
 * one's is `other` or `unsure`.
 */
export function decisionVerdict(
  data: Extract<WorkflowNode, { type: 'decision' }>['data'],
  answer: DecisionAnswer | undefined
): { output: string, sure: boolean } {
  if (data.question === 'choice') {
    const choice = answer?.choice
    if (choice && choice in data.options && answer!.confidence >= (data.thresholds[choice] ?? 0)) {
      return { output: choice, sure: true }
    }
    return { output: CHOICE_OTHER, sure: false }
  }

  const yes = answer?.yes
  if (yes === undefined) {
    return { output: 'unsure', sure: false }
  }
  if (yes >= data.thresholds.yes) {
    return { output: 'yes', sure: true }
  }
  if ((1 - yes) >= data.thresholds.no) {
    return { output: 'no', sure: true }
  }
  return { output: 'unsure', sure: false }
}

/** What a paused decision asks the user: the node's instructions and its outputs */
export function reviewForNode(node: Extract<WorkflowNode, { type: 'decision' }>): DecisionReview {
  return {
    instructions: node.data.instructions,
    outputs: nodeOutputs(node),
    options: node.data.question === 'choice' ? { ...node.data.options } : undefined
  }
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

  // Every variable an extract node defines anywhere in the graph; a notify may use
  // it regardless of whether that node sits before it on every path.
  const extracted = new Set<string>()
  for (const node of graph.nodes) {
    if (node.type === 'action' && node.data.action.type === 'extract' && !extractActionError(node.data.action)) {
      extracted.add(node.data.action.variable)
    }
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
    if (node.type === 'decision') {
      const fallbacks = node.data.fallbacks ?? []
      if (fallbacks.some((fallback, index) => fallback.type === 'human' && index < fallbacks.length - 1)) {
        errors.push({ nodeId: node.id, message: 'Nothing after a human check is ever reached' })
      }
    }
    if (node.type === 'action' && domain) {
      const allowed = domain === 'mail' ? MAIL_ACTIONS : DOCUMENT_ACTIONS
      if (!isGenericAction(node.data.action) && !allowed.has(node.data.action.type)) {
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
      if (action.type === 'extract') {
        const error = extractActionError(action)
        if (error) {
          errors.push({ nodeId: node.id, message: error })
        }
      }
      if (action.type === 'notify') {
        const text = [action.title, action.body, action.modal?.title, action.modal?.text]
          .filter((value): value is string => typeof value === 'string')
          .join('\n')
        for (const variable of templateVariables(text)) {
          if (!(BUILTIN_VARIABLES as readonly string[]).includes(variable) && !extracted.has(variable)) {
            errors.push({ nodeId: node.id, message: `{{${variable}}} is never extracted` })
          }
        }
      }
      if (action.type === 'save-to-drive') {
        if (!action.service.trim()) {
          errors.push({ nodeId: node.id, message: 'The save-to-drive action needs a drive service' })
        }
        const folder = action.folder.trim()
        if (!folder) {
          errors.push({ nodeId: node.id, message: 'The save-to-drive action needs a folder' })
        } else if (!normalizeDriveFolderInput(folder)) {
          errors.push({ nodeId: node.id, message: 'The save-to-drive folder must be a path like /my-files/Public' })
        }
        for (const glob of action.accept ?? []) {
          if (!isMimeGlob(glob)) {
            errors.push({ nodeId: node.id, message: `"${glob}" is not a media type like video/* or application/pdf` })
          }
        }
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

export interface WorkflowRunOptions extends WorkflowBatchOptions {
  /** Called for each decision node reached; useful for progress or per-node answers */
  onAnswer?: (nodeId: string, answer: DecisionAnswer | undefined) => void
}

/** The decision node one item is currently answering, across the waves of a batch walk */
interface PendingDecision {
  nodeId: string
  question: DecisionQuestion
  /** The question's shape; the primary answer is cached under it */
  hash: string
  /** 0 = the node's own engine, 1.. = the fallback at that index */
  stage: number
  /** The unsure answers the walk moved past, in order */
  attempts: DecisionAttempt[]
}

interface WalkState {
  item: AutomationItem
  node: WorkflowNode | undefined
  steps: number
  /** The node the last step counted, so a wave that resumes the same decision does not count again */
  lastNodeId?: string
  done: boolean
  path: WorkflowPathStep[]
  answers: Record<string, DecisionAnswer>
  /** Answers already received, keyed by stage and question shape, so a repeated question is not asked twice */
  cache: Map<string, DecisionAnswer | undefined>
  /** Stage keys a fallback could not answer at all, with the reason; skipped on the next pass */
  unavailable: Map<string, string>
  decision?: PendingDecision
  actions: PlannedAction[]
  /** The decision node that paused the walk for a human */
  review?: string
  error?: string
}

/** What answering the current stage of a decision produced */
type StageOutcome
  = | { kind: 'ask', cacheKey: string, question: DecisionQuestion, fallback?: Extract<DecisionFallback, { type: 'ai' }> }
    | { kind: 'advance' }
    | { kind: 'done', output: string, source: DecisionSource, answer?: DecisionAnswer, attempts: DecisionAttempt[] }
    | { kind: 'review', review: DecisionReview }

/** The cache key of a stage: the primary engine, or one AI fallback and its model */
function stageKey(stage: number, fallback: DecisionFallback | undefined, hash: string): string {
  if (stage === 0 || !fallback) {
    return `engine|${hash}`
  }
  return `ai|${fallback.type === 'ai' ? fallback.model ?? '' : ''}|${hash}`
}

/**
 * The next thing to do at a decision node: ask the current stage, move to the next
 * one, finish on a sure answer (or an exhausted chain), or pause for a human.
 */
function stageOutcome(state: WalkState, decision: PendingDecision, node: Extract<WorkflowNode, { type: 'decision' }>): StageOutcome {
  const data = node.data
  const fallbacks = data.fallbacks ?? []

  if (decision.stage > fallbacks.length) {
    // Every fallback was unsure; the chain's last attempt names the output, the
    // attempts before it stay in the step's chain
    const last = decision.attempts.at(-1)
    return {
      kind: 'done',
      output: last?.output ?? decisionVerdict(data, undefined).output,
      source: last?.source ?? 'engine',
      answer: last?.answer,
      attempts: decision.attempts.slice(0, -1)
    }
  }

  const fallback = decision.stage === 0 ? undefined : fallbacks[decision.stage - 1]
  const key = stageKey(decision.stage, fallback, decision.hash)

  if (fallback?.type === 'human') {
    return { kind: 'review', review: reviewForNode(node) }
  }

  // A fallback that cannot answer is recorded and skipped, not fatal
  const unavailable = state.unavailable.get(key)
  if (unavailable !== undefined) {
    decision.attempts.push({
      source: 'ai',
      output: decisionVerdict(data, undefined).output,
      error: unavailable
    })
    decision.stage++
    return { kind: 'advance' }
  }

  if (!state.cache.has(key)) {
    return {
      kind: 'ask',
      cacheKey: key,
      question: decision.question,
      fallback: fallback?.type === 'ai' ? fallback : undefined
    }
  }

  const answer = state.cache.get(key)
  const verdict = decisionVerdict(data, answer)
  const source: DecisionSource = decision.stage === 0 ? 'engine' : 'ai'

  if (verdict.sure) {
    return { kind: 'done', output: verdict.output, source, answer, attempts: [...decision.attempts] }
  }

  decision.attempts.push({ source, output: verdict.output, answer })
  decision.stage++
  return { kind: 'advance' }
}

/**
 * Walks the graph for a group of items, batching decision nodes: items are advanced
 * until each reaches its next unanswered question, then one batch call answers every
 * item waiting on the same question. The per-item walk stays lazy (the path depends
 * on earlier answers); a missing edge ends an item's walk and a failed batch call
 * marks the items that were waiting on it with `error` without failing the others.
 *
 * A decision node that is unsure hands the item to its fallbacks in order (an AI
 * model, then a human); a human fallback pauses the walk with `review`, and the
 * caller resumes it later with the human's answer as a preset.
 */
export async function runWorkflowBatch(
  graph: WorkflowGraph,
  items: AutomationItem[],
  decideBatch: WorkflowDecideBatch,
  options: WorkflowBatchOptions = {}
): Promise<WorkflowBatchResult[]> {
  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  const trigger = graph.nodes.find(node => node.type === 'trigger')
  // Every decision node costs one visit per stage (its engine plus each fallback)
  const fallbackCount = graph.nodes.reduce((total, node) =>
    total + (node.type === 'decision' ? node.data.fallbacks?.length ?? 0 : 0), 0)
  const limit = graph.nodes.length + fallbackCount + 1
  const states: WalkState[] = items.map(item => ({
    item,
    node: trigger,
    steps: 0,
    done: !trigger,
    path: [],
    answers: {},
    cache: new Map(),
    unavailable: new Map(),
    actions: []
  }))

  const resultOf = (state: WalkState): WorkflowBatchResult => ({
    path: state.path,
    answers: state.answers,
    actions: state.actions,
    review: state.review,
    error: state.error
  })

  // Every item is reported once, as soon as its walk ends
  const reported = new Set<number>()
  const reportDone = () => {
    if (!options.onItemDone) {
      return
    }
    states.forEach((state, index) => {
      if (state.done && !reported.has(index)) {
        reported.add(index)
        options.onItemDone!(index, resultOf(state))
      }
    })
  }

  for (;;) {
    // Advance every item to its next unanswered question (or its end)
    const pending = new Map<string, {
      nodeId: string
      hash: string
      question: DecisionQuestion
      fallback?: Extract<DecisionFallback, { type: 'ai' }>
      waiting: Array<{ state: WalkState, cacheKey: string }>
    }>()

    for (const state of states) {
      while (!state.done && state.node) {
        const node = state.node
        if (state.lastNodeId !== node.id) {
          state.steps++
          state.lastNodeId = node.id
        }

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
          const preset = options.preset?.[node.id]
          if (preset && !state.decision) {
            state.path.push({
              nodeId: node.id,
              output: preset.output,
              answer: preset.answer,
              source: preset.source,
              attempts: preset.attempts?.length ? preset.attempts : undefined
            })
            if (preset.answer) {
              state.answers[node.id] = preset.answer
            }
            state.node = follow(graph, byId, node.id, preset.output)
            state.done = !state.node
            continue
          }

          const question = questionForNode(node)
          const decision = state.decision ?? {
            nodeId: node.id,
            question,
            hash: JSON.stringify(question),
            stage: 0,
            attempts: []
          }
          state.decision = decision

          const outcome = stageOutcome(state, decision, node)

          if (outcome.kind === 'ask') {
            const group = pending.get(outcome.cacheKey) ?? {
              nodeId: node.id,
              hash: decision.hash,
              question: outcome.question,
              fallback: outcome.fallback,
              waiting: []
            }
            group.waiting.push({ state, cacheKey: outcome.cacheKey })
            pending.set(outcome.cacheKey, group)
            break
          }

          if (outcome.kind === 'advance') {
            continue
          }

          if (outcome.kind === 'review') {
            // A paused walk keeps its path, but its planned actions are dropped: the
            // resume recomputes them from the human's answer
            state.path.push({
              nodeId: node.id,
              output: 'review',
              attempts: decision.attempts.length ? decision.attempts : undefined,
              review: outcome.review
            })
            state.review = node.id
            state.actions = []
            state.done = true
            break
          }

          if (outcome.answer) {
            state.answers[node.id] = outcome.answer
          }
          state.path.push({
            nodeId: node.id,
            output: outcome.output,
            answer: outcome.answer,
            source: outcome.source,
            attempts: outcome.attempts.length ? outcome.attempts : undefined
          })
          state.decision = undefined
          state.node = follow(graph, byId, node.id, outcome.output)
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

    reportDone()

    if (!pending.size) {
      break
    }

    // One batch call per stage per question per wave; sequential so several nodes do
    // not overload the single-worker inference server
    for (const group of pending.values()) {
      options.signal?.throwIfAborted()
      options.onDecide?.(group.nodeId, group.waiting.length)
      const questions = { [group.hash]: group.question }
      const batchStates = group.waiting.map(entry => entry.state.item.state)
      let results: Array<Record<string, DecisionAnswer>> | undefined
      let failure: unknown
      let unavailable: unknown

      try {
        if (group.fallback) {
          results = options.fallback
            ? await options.fallback(group.fallback, batchStates, questions)
            : undefined
          if (!options.fallback) {
            unavailable = new FallbackUnavailableError()
          }
        } else {
          results = await decideBatch(batchStates, questions)
        }
      } catch (error) {
        if (group.fallback && error instanceof FallbackUnavailableError) {
          unavailable = error
        } else {
          failure = error
        }
      }

      group.waiting.forEach((entry, index) => {
        if (failure !== undefined) {
          entry.state.error ??= failureMessage(failure)
          entry.state.done = true
          return
        }
        if (unavailable !== undefined) {
          entry.state.unavailable.set(entry.cacheKey, failureMessage(unavailable))
          return
        }
        entry.state.cache.set(entry.cacheKey, results?.[index]?.[group.hash])
      })
      // Items whose batch call failed end here
      reportDone()
    }
  }

  return states.map(resultOf)
}

/** The message of a thrown value, for an attempt's `error` */
function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  const [result] = await runWorkflowBatch(
    graph,
    [item],
    async (states, questions) => [await decide(states[0]!, questions)],
    { fallback: options.fallback, preset: options.preset }
  )
  for (const step of result?.path ?? []) {
    options.onAnswer?.(step.nodeId, step.answer)
  }
  if (result?.error) {
    throw new Error(result.error)
  }
  return { path: result?.path ?? [], answers: result?.answers ?? {}, actions: result?.actions ?? [], review: result?.review }
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
