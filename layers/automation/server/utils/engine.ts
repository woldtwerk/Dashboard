import type {
  AppliedAction,
  AutomationAction,
  AutomationDomain,
  AutomationItem,
  AutomationRun,
  AutomationWorkflow,
  DecisionAnswer,
  PlannedAction,
  UndoOperation,
  WorkflowPathStep,
  WorkflowRunItemResult
} from '../../shared/types/automation'
import { createError } from 'nuxt/server'
import { nextAttempt, planUndo, selectActions } from '../../shared/automation'
import { nodeOutputs, runWorkflowBatch } from '../../shared/workflow'
import type { PresetDecision, WorkflowDecide, WorkflowDecideBatch, WorkflowFallbackDecideBatch } from '../../shared/workflow'
import { runActions } from './action-runner'
import { itemRef } from './automation-items'
import { MANUAL_RUN_LOST_LOCK } from './manual-run'
import type { SeenState } from './runs'

/**
 * A failure that is worth retrying: the decision engine is unavailable, a call
 * timed out, the server answered 5xx or the network dropped. Anything that reaches
 * the engine's per-item catch block is treated this way; a failure that is final
 * (an action the provider refused) is caught and recorded inside the workflow.
 */
export class TransientEvaluationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransientEvaluationError'
  }
}

/** Persistence the runner needs; the cache-database implementation is `runs.ts` */
export interface AutomationStore {
  /** New items plus items whose earlier attempt failed and is due for a retry */
  due(domain: AutomationDomain, service: string, keys: string[], now: Date): Promise<SeenState[]>
  /** The item was evaluated; it is never looked at again */
  markEvaluated(domain: AutomationDomain, service: string, itemKey: string, now: Date): Promise<void>
  /** A transient failure; a null `nextAttemptAt` means the item is given up */
  recordAttempt(domain: AutomationDomain, service: string, itemKey: string, attempts: number, nextAttemptAt: Date | null, now: Date): Promise<void>
  record(input: {
    workflow: string
    workflowName: string
    domain: AutomationDomain
    service: string
    item: AutomationItem
    path: WorkflowPathStep[]
    answers: Record<string, DecisionAnswer>
    outcome: AutomationRun['outcome']
    actions: PlannedAction[]
    applied?: AppliedAction[]
    error?: string
    at?: Date
  }): Promise<AutomationRun>
  /** Rewrites an existing run, e.g. when a paused review was answered */
  update(id: string, patch: {
    outcome?: AutomationRun['outcome']
    path?: WorkflowPathStep[]
    answers?: Record<string, DecisionAnswer>
    actions?: PlannedAction[]
    applied?: AppliedAction[]
    feedback?: AutomationRun['feedback'] | null
    error?: string | null
  }): Promise<AutomationRun>
  /** One stored run; throws 404 when it is gone */
  get(id: string): Promise<AutomationRun>
}

/** Applies a workflow's actions to one item and reverses them later */
export interface AutomationApplier {
  /** Runs the actions in order, tracking the item (e.g. a mail's new uid); returns what to record */
  apply(actions: AutomationAction[], item: AutomationItem): Promise<{ applied: AppliedAction[], item: AutomationItem }>
  undo(operations: UndoOperation[]): Promise<void>
}

/** Just the logger the runner uses; matches the consola instance across the server */
export interface AutomationLogger {
  info?: (message: string, meta?: Record<string, unknown>) => void
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
}

export interface AutomationDeps {
  store: AutomationStore
  /** Absent when no engine is configured: a workflow with a decision node cannot run */
  decide?: WorkflowDecide
  /** The batch form of `decide`; preferred so one wave of items costs one call */
  decideBatch?: WorkflowDecideBatch
  /** Answers a decision node's AI fallbacks when the engine is unsure */
  fallbackDecideBatch?: WorkflowFallbackDecideBatch
  /** Candidate items of one service, newest first */
  loadItems: (domain: AutomationDomain, service: string, limit: number) => Promise<AutomationItem[]>
  /** The applier of one service; the runtime builds it from the domain provider */
  applierFor: (domain: AutomationDomain, service: string) => AutomationApplier | Promise<AutomationApplier>
  /** Announces a suggestion; a failure never fails the run */
  notify?: (run: AutomationRun) => Promise<void>
  /**
   * Announces the notifications an applied run produced; called after the run is
   * recorded, so the notification can be tied to its run id. A failure never fails
   * the run.
   */
  announceNotifications?: (run: AutomationRun) => Promise<void>
  /** Announces that an item was given up after repeated transient failures */
  notifyFailed?: (domain: AutomationDomain, service: string, item: AutomationItem, error: unknown) => Promise<void>
  logger?: AutomationLogger
  now?: () => Date
}

/** The workflows of one service in run order: for the service, or for every service */
export function workflowsForService(workflows: AutomationWorkflow[], domain: AutomationDomain, service: string): AutomationWorkflow[] {
  return workflows
    .filter(workflow => workflow.domain === domain && (workflow.service === null || workflow.service === service))
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
}

function hasDecisionNode(workflow: AutomationWorkflow): boolean {
  return workflow.graph.nodes.some(node => node.type === 'decision')
}

/**
 * Runs one (domain, service): loads its new items and evaluates them. The item
 * loading is the engine's default; the safety-net sweep feeds items in directly
 * through `evaluateCandidates`.
 */
export async function runService(
  domain: AutomationDomain,
  service: string,
  workflows: AutomationWorkflow[],
  deps: AutomationDeps
): Promise<AutomationRun[]> {
  const candidates = await deps.loadItems(domain, service, 500)
  return await evaluateCandidates(domain, service, candidates, workflows, deps)
}

/**
 * Evaluates candidate items against the workflows. Only items that are new or due
 * for a retry are evaluated; an item is marked evaluated only once its evaluation
 * produced a final outcome. A transient failure (the engine is down) records an
 * attempt and schedules the next one; after the last retry the item is given up
 * with a failed run and a notification.
 */
export async function evaluateCandidates(
  domain: AutomationDomain,
  service: string,
  candidates: AutomationItem[],
  workflows: AutomationWorkflow[],
  deps: AutomationDeps
): Promise<AutomationRun[]> {
  if (!candidates.length) {
    return []
  }

  const now = deps.now?.() ?? new Date()
  const due = await deps.store.due(domain, service, candidates.map(item => item.key), now)
  const attemptsByKey = new Map(due.map(state => [state.itemKey, state.attempts]))
  const items = candidates.filter(item => attemptsByKey.has(item.key))
  if (!items.length) {
    return []
  }

  const serviceWorkflows = workflowsForService(workflows, domain, service).filter(workflow => workflow.enabled)
  const evaluations = await evaluateItems(domain, items, serviceWorkflows, deps)
  const runs: AutomationRun[] = []

  for (const evaluation of evaluations) {
    const attempts = attemptsByKey.get(evaluation.item.key) ?? 0

    try {
      if (evaluation.error) {
        throw evaluation.error
      }
      runs.push(...await recordTriggered(domain, service, evaluation.item, evaluation.triggered, deps))
      await deps.store.markEvaluated(domain, service, evaluation.item.key, now)
    } catch (error) {
      const next = nextAttempt(attempts + 1, now)
      await deps.store.recordAttempt(domain, service, evaluation.item.key, attempts + 1, next, now)

      if (next) {
        deps.logger?.warn?.('Automation evaluation failed, will retry', {
          item: evaluation.item.key,
          attempts: attempts + 1,
          error: errorMessage(error)
        })
        continue
      }

      deps.logger?.warn?.('Automation evaluation gave up', { item: evaluation.item.key, error: errorMessage(error) })
      runs.push(...await recordGiveUp(domain, service, evaluation.item, serviceWorkflows, error, deps))

      try {
        await deps.notifyFailed?.(domain, service, evaluation.item, error)
      } catch (notifyError) {
        deps.logger?.warn?.('Could not send the automation failure notification', { error: errorMessage(notifyError) })
      }
    }
  }

  if (runs.length) {
    deps.logger?.info?.('Automation evaluated items', { items: items.length, runs: runs.length })
  }

  return runs
}

/** Lease renewal for a manual run; every item is checked before it is touched */
export interface WorkflowManualRunOptions {
  /**
   * Renews the caller's lease. Called before the walk and before each following
   * item; false means the lease was lost and the rest must not be applied.
   */
  beforeItem?: () => Promise<boolean>
}

/**
 * Runs exactly one workflow against items the user picked, with the new-item
 * rules: one batched walk with the engine and its fallbacks, `recordWorkflow`
 * semantics per mode, review runs and notifications. Unlike the trigger path it
 * never consults or writes the seen/retry table — a manual run must not hide the
 * item from future automation — and a decision-engine failure becomes a failed
 * result instead of a retry.
 */
export async function runWorkflowOnItems(
  workflow: AutomationWorkflow,
  items: AutomationItem[],
  deps: AutomationDeps,
  options: WorkflowManualRunOptions = {}
): Promise<WorkflowRunItemResult[]> {
  if (!items.length) {
    return []
  }

  const beforeItem = options.beforeItem
  if (beforeItem && !(await beforeItem())) {
    return items.map(lostLockResult)
  }

  const decideBatch = resolveDecideBatch(deps)
  if (hasDecisionNode(workflow) && !decideBatch) {
    const results: WorkflowRunItemResult[] = []
    for (const [index, item] of items.entries()) {
      if (index > 0 && beforeItem && !(await beforeItem())) {
        results.push(...items.slice(index).map(lostLockResult))
        break
      }
      results.push(await recordManualFailure(workflow, item, 'No decision engine is configured', deps))
    }
    return results
  }

  const results = await runWorkflowBatch(workflow.graph, items, decideBatch ?? emptyDecideBatch, {
    fallback: deps.fallbackDecideBatch
  })

  const output: WorkflowRunItemResult[] = []
  for (const [index, item] of items.entries()) {
    if (index > 0 && beforeItem && !(await beforeItem())) {
      output.push(...items.slice(index).map(lostLockResult))
      break
    }

    const result = results[index]

    if (!result || result.error) {
      output.push(await recordManualFailure(workflow, item, result?.error ?? 'The workflow could not be evaluated', deps))
      continue
    }

    // No first-wins selection: the user picked this workflow, so its actions run
    const run = await recordWorkflow(
      workflow.domain,
      item.service,
      workflow,
      item,
      result.path,
      result.answers,
      result.actions,
      deps,
      result.review
    )
    output.push({ ref: itemRef(item), outcome: run.outcome, runId: run.id, error: run.error })
  }

  return output
}

/** The result of an item that was not touched because the lease is gone */
function lostLockResult(item: AutomationItem): WorkflowRunItemResult {
  return { ref: itemRef(item), outcome: 'failed', error: MANUAL_RUN_LOST_LOCK }
}

/** A manual run that could not evaluate an item records a failed run, but no retry */
async function recordManualFailure(
  workflow: AutomationWorkflow,
  item: AutomationItem,
  error: unknown,
  deps: AutomationDeps
): Promise<WorkflowRunItemResult> {
  const message = errorMessage(error)
  const run = await deps.store.record({
    workflow: workflow.id,
    workflowName: workflow.name,
    domain: workflow.domain,
    service: item.service,
    item,
    path: [],
    answers: {},
    outcome: 'failed',
    actions: [],
    error: message,
    at: deps.now?.()
  })

  return { ref: itemRef(item), outcome: 'failed', runId: run.id, error: message }
}

/** One workflow that would act on an item */
interface TriggeredWorkflow {
  workflow: AutomationWorkflow
  path: WorkflowPathStep[]
  answers: Record<string, DecisionAnswer>
  actions: PlannedAction[]
  /** Set when the walk paused for a human; the node awaiting an answer */
  review?: string
}

/** What the walk produced for one item */
interface ItemEvaluation {
  item: AutomationItem
  triggered: TriggeredWorkflow[]
  error?: unknown
}

/**
 * Walks every workflow for the whole group of items, batching decision nodes (one
 * call per node per wave). An item's walk error is captured on its evaluation and
 * never affects the other items.
 */
async function evaluateItems(
  domain: AutomationDomain,
  items: AutomationItem[],
  workflows: AutomationWorkflow[],
  deps: AutomationDeps
): Promise<ItemEvaluation[]> {
  const evaluations: ItemEvaluation[] = items.map(item => ({ item, triggered: [] }))
  const byKey = new Map(evaluations.map(evaluation => [evaluation.item.key, evaluation]))
  const decideBatch = resolveDecideBatch(deps)

  if (workflows.some(hasDecisionNode) && !decideBatch) {
    const error = new TransientEvaluationError('No decision engine is configured')
    for (const evaluation of evaluations) {
      evaluation.error = error
    }
    return evaluations
  }

  for (const workflow of workflows) {
    const results = await runWorkflowBatch(workflow.graph, items, decideBatch ?? emptyDecideBatch, {
      fallback: deps.fallbackDecideBatch
    })

    results.forEach((result, index) => {
      const evaluation = byKey.get(items[index]!.key)
      if (!evaluation) {
        return
      }
      if (result.error) {
        evaluation.error ??= new TransientEvaluationError(result.error)
        return
      }
      if (result.actions.length || result.review) {
        evaluation.triggered.push({
          workflow,
          path: result.path,
          answers: result.answers,
          actions: result.actions,
          review: result.review
        })
      }
    })
  }

  return evaluations
}

/** The batch decider from the deps; a single decider is adapted into one */
function resolveDecideBatch(deps: AutomationDeps): WorkflowDecideBatch | undefined {
  if (deps.decideBatch) {
    return deps.decideBatch
  }
  const decide = deps.decide
  if (!decide) {
    return undefined
  }

  return async (states, questions) => {
    const answers: Array<Record<string, DecisionAnswer>> = []
    for (const state of states) {
      answers.push(await decide(state, questions))
    }
    return answers
  }
}

const emptyDecideBatch: WorkflowDecideBatch = async () => []/** Selects the first-wins actions and records one run per triggered workflow */
async function recordTriggered(
  domain: AutomationDomain,
  service: string,
  item: AutomationItem,
  triggered: TriggeredWorkflow[],
  deps: AutomationDeps
): Promise<AutomationRun[]> {
  if (!triggered.length) {
    return []
  }

  // A paused review acts later, on its own: it must not claim an action type from
  // the workflows that are ready now
  const actionable = triggered.filter(entry => !entry.review)
  const selected = selectActions(actionable.map(entry => ({ id: entry.workflow.id, actions: entry.actions })))
  const chosenByWorkflow = new Map<string, PlannedAction[]>()
  for (const { workflow: id, nodeId, action } of selected) {
    chosenByWorkflow.set(id, [...(chosenByWorkflow.get(id) ?? []), { nodeId, action }])
  }

  const runs: AutomationRun[] = []
  for (const entry of triggered) {
    const chosen = chosenByWorkflow.get(entry.workflow.id) ?? []
    runs.push(await recordWorkflow(domain, service, entry.workflow, item, entry.path, entry.answers, chosen, deps, entry.review))
  }
  return runs
}

/** Records the failure of every workflow that needed the engine but could not run */
async function recordGiveUp(
  domain: AutomationDomain,
  service: string,
  item: AutomationItem,
  workflows: AutomationWorkflow[],
  error: unknown,
  deps: AutomationDeps
): Promise<AutomationRun[]> {
  const runs: AutomationRun[] = []

  for (const workflow of workflows.filter(hasDecisionNode)) {
    runs.push(await deps.store.record({
      workflow: workflow.id,
      workflowName: workflow.name,
      domain,
      service,
      item,
      path: [],
      answers: {},
      outcome: 'failed',
      actions: [],
      error: errorMessage(error),
      at: deps.now?.()
    }))
  }

  return runs
}

async function recordWorkflow(
  domain: AutomationDomain,
  service: string,
  workflow: AutomationWorkflow,
  item: AutomationItem,
  path: WorkflowPathStep[],
  answers: Record<string, DecisionAnswer>,
  actions: PlannedAction[],
  deps: AutomationDeps,
  review?: string
): Promise<AutomationRun> {
  // A paused review has no actions yet: the resume plans them from the human's answer
  if (review) {
    const run = await deps.store.record({
      workflow: workflow.id,
      workflowName: workflow.name,
      domain,
      service,
      item,
      path,
      answers,
      outcome: 'review',
      actions: [],
      at: deps.now?.()
    })

    try {
      await deps.notify?.(run)
    } catch (error) {
      deps.logger?.warn?.('Could not send the automation review request', { error: errorMessage(error) })
    }

    return run
  }

  if (!actions.length) {
    return await deps.store.record({
      workflow: workflow.id,
      workflowName: workflow.name,
      domain,
      service,
      item,
      path,
      answers,
      outcome: 'skipped',
      actions: [],
      at: deps.now?.()
    })
  }

  if (workflow.mode === 'suggest') {
    const run = await deps.store.record({
      workflow: workflow.id,
      workflowName: workflow.name,
      domain,
      service,
      item,
      path,
      answers,
      outcome: 'suggested',
      actions,
      at: deps.now?.()
    })

    try {
      await deps.notify?.(run)
    } catch (error) {
      deps.logger?.warn?.('Could not send the automation suggestion', { error: errorMessage(error) })
    }

    return run
  }

  const applier = await deps.applierFor(domain, service)

  try {
    const { applied } = await runActions(actions, item, applier, { workflow: workflow.name, now: deps.now })
    const run = await deps.store.record({
      workflow: workflow.id,
      workflowName: workflow.name,
      domain,
      service,
      item,
      path,
      answers,
      outcome: 'applied',
      actions,
      applied,
      at: deps.now?.()
    })
    deps.logger?.info?.('Automation applied', { workflow: workflow.name })
    await announceRunNotifications(run, deps)
    return run
  } catch (error) {
    deps.logger?.warn?.('Automation action failed', { workflow: workflow.name, error: errorMessage(error) })
    return await deps.store.record({
      workflow: workflow.id,
      workflowName: workflow.name,
      domain,
      service,
      item,
      path,
      answers,
      outcome: 'failed',
      actions,
      error: errorMessage(error),
      at: deps.now?.()
    })
  }
}

/** The dependencies answering a paused review needs; `store` is the same runs store */
export interface AutomationReviewDeps {
  store: Pick<AutomationStore, 'get' | 'update'>
  /** The workflow that paused; undefined when it was deleted meanwhile */
  loadWorkflow: (id: string) => Promise<AutomationWorkflow | undefined>
  decideBatch?: WorkflowDecideBatch
  fallbackDecideBatch?: WorkflowFallbackDecideBatch
  applierFor: AutomationDeps['applierFor']
  notify?: AutomationDeps['notify']
  announceNotifications?: AutomationDeps['announceNotifications']
  logger?: AutomationLogger
  now?: () => Date
}

/**
 * Answers a paused review with one of the node's outputs and resumes the run: the
 * stored path's decisions become presets, so the walk does not ask them again, and
 * the chosen output is the human's answer for the paused node. The same run row is
 * rewritten: another human fallback leaves it in `review`, otherwise the workflow's
 * mode decides whether the planned actions are applied or suggested.
 *
 * The caller holds the run's lock and re-reads the run inside it, so two workers or
 * a double click cannot answer the same review twice.
 */
export async function answerReview(runId: string, output: string, deps: AutomationReviewDeps): Promise<AutomationRun> {
  const run = await deps.store.get(runId)
  if (run.outcome !== 'review') {
    throw createError({ status: 409, statusText: 'Only a run that awaits a review can be answered' })
  }

  const workflow = await deps.loadWorkflow(run.workflow)
  if (!workflow) {
    throw createError({ status: 409, statusText: 'The workflow of this review no longer exists' })
  }

  const paused = run.path.find(step => step.output === 'review')
  const node = paused ? workflow.graph.nodes.find(candidate => candidate.id === paused.nodeId) : undefined
  if (!paused || !node || node.type !== 'decision') {
    throw createError({ status: 409, statusText: 'The decision that asked for a review no longer exists' })
  }

  if (!nodeOutputs(node).includes(output)) {
    throw createError({ status: 400, statusText: `"${output}" is not an output of this decision` })
  }

  const preset: Record<string, PresetDecision> = {}
  for (const step of run.path) {
    if (step.output === 'review' || !step.source) {
      continue
    }
    preset[step.nodeId] = {
      output: step.output,
      source: step.source,
      answer: step.answer,
      attempts: step.attempts
    }
  }
  preset[paused.nodeId] = { output, source: 'human', attempts: paused.attempts }

  const decideBatch = deps.decideBatch ?? emptyDecideBatch
  const [result] = await runWorkflowBatch(workflow.graph, [run.item], decideBatch, {
    fallback: deps.fallbackDecideBatch,
    preset
  })

  if (!result || result.error) {
    throw createError({ status: 502, statusText: result?.error ?? 'The workflow could not be resumed' })
  }

  if (result.review) {
    const updated = await deps.store.update(runId, {
      outcome: 'review',
      path: result.path,
      answers: result.answers,
      actions: [],
      feedback: 'answered'
    })
    try {
      await deps.notify?.(updated)
    } catch (error) {
      deps.logger?.warn?.('Could not send the automation review request', { error: errorMessage(error) })
    }
    return updated
  }

  if (!result.actions.length) {
    return await deps.store.update(runId, {
      outcome: 'skipped',
      path: result.path,
      answers: result.answers,
      actions: [],
      feedback: 'answered'
    })
  }

  if (workflow.mode === 'suggest') {
    const updated = await deps.store.update(runId, {
      outcome: 'suggested',
      path: result.path,
      answers: result.answers,
      actions: result.actions,
      feedback: 'answered'
    })
    try {
      await deps.notify?.(updated)
    } catch (error) {
      deps.logger?.warn?.('Could not send the automation suggestion', { error: errorMessage(error) })
    }
    return updated
  }

  const applier = await deps.applierFor(run.domain, run.service)

  try {
    const { applied } = await runActions(result.actions, run.item, applier, { workflow: workflow.name, now: deps.now })
    const updated = await deps.store.update(runId, {
      outcome: 'applied',
      path: result.path,
      answers: result.answers,
      actions: result.actions,
      applied,
      feedback: 'answered'
    })
    await announceRunNotifications(updated, deps)
    return updated
  } catch (error) {
    deps.logger?.warn?.('Automation action failed', { workflow: workflow.name, error: errorMessage(error) })
    return await deps.store.update(runId, {
      outcome: 'failed',
      path: result.path,
      answers: result.answers,
      actions: result.actions,
      error: errorMessage(error),
      feedback: 'answered'
    })
  }
}

/** Applies the actions of a suggestion and returns what a reversal needs */
export async function applyRunActions(run: AutomationRun, applier: AutomationApplier, now?: () => Date) {
  return await runActions(run.actions, run.item, applier, { workflow: run.workflowName, now })
}

/**
 * Announces the notifications an applied run produced, after the run was recorded
 * so the notification and the live modal can address it by id. Best-effort, like
 * `notify`: a failure is logged and never fails the run.
 */
export async function announceRunNotifications(
  run: AutomationRun,
  deps: { announceNotifications?: AutomationDeps['announceNotifications'], logger?: AutomationLogger }
): Promise<void> {
  if (!run.applied.some(action => action.type === 'notify')) {
    return
  }
  try {
    await deps.announceNotifications?.(run)
  } catch (error) {
    deps.logger?.warn?.('Could not send the workflow notifications', { error: errorMessage(error) })
  }
}

/** The reversal steps of an applied run */
export function undoPlan(run: AutomationRun): UndoOperation[] {
  return planUndo(run.applied)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
