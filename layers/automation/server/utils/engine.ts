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
  WorkflowPathStep
} from '../../shared/types/automation'
import { nextAttempt, planUndo, selectActions } from '../../shared/automation'
import { runWorkflowBatch } from '../../shared/workflow'
import type { WorkflowDecide, WorkflowDecideBatch } from '../../shared/workflow'
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
  /** Candidate items of one service, newest first */
  loadItems: (domain: AutomationDomain, service: string, limit: number) => Promise<AutomationItem[]>
  /** The applier of one service; the runtime builds it from the domain provider */
  applierFor: (domain: AutomationDomain, service: string) => AutomationApplier | Promise<AutomationApplier>
  /** Announces a suggestion; a failure never fails the run */
  notify?: (run: AutomationRun) => Promise<void>
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

/** One workflow that would act on an item */
interface TriggeredWorkflow {
  workflow: AutomationWorkflow
  path: WorkflowPathStep[]
  answers: Record<string, DecisionAnswer>
  actions: PlannedAction[]
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
    const results = await runWorkflowBatch(workflow.graph, items, decideBatch ?? emptyDecideBatch)

    results.forEach((result, index) => {
      const evaluation = byKey.get(items[index]!.key)
      if (!evaluation) {
        return
      }
      if (result.error) {
        evaluation.error ??= new TransientEvaluationError(result.error)
        return
      }
      if (result.actions.length) {
        evaluation.triggered.push({ workflow, path: result.path, answers: result.answers, actions: result.actions })
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

  const selected = selectActions(triggered.map(entry => ({ id: entry.workflow.id, actions: entry.actions })))
  const chosenByWorkflow = new Map<string, PlannedAction[]>()
  for (const { workflow: id, nodeId, action } of selected) {
    chosenByWorkflow.set(id, [...(chosenByWorkflow.get(id) ?? []), { nodeId, action }])
  }

  const runs: AutomationRun[] = []
  for (const entry of triggered) {
    const chosen = chosenByWorkflow.get(entry.workflow.id) ?? []
    runs.push(await recordWorkflow(domain, service, entry.workflow, item, entry.path, entry.answers, chosen, deps))
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
  deps: AutomationDeps
): Promise<AutomationRun> {
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
    const { applied } = await applier.apply(actions.map(planned => planned.action), item)
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

/** Applies the actions of a suggestion and returns what a reversal needs */
export async function applyRunActions(run: AutomationRun, applier: AutomationApplier) {
  return await applier.apply(run.actions.map(planned => planned.action), run.item)
}

/** The reversal steps of an applied run */
export function undoPlan(run: AutomationRun): UndoOperation[] {
  return planUndo(run.applied)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
