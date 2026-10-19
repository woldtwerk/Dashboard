import type {
  AutomationRun,
  AutomationWorkflow,
  WorkflowNode,
  WorkflowPathStep
} from '../../../automation/shared/types/automation'
import { questionForNode } from '../../../automation/shared/workflow'
import type { LayaQuestion } from './mapping'
import { toLayaQuestions } from './mapping'

/**
 * Builds the rows `laya-train` reads from the activity runs. Pure: the HTTP endpoint
 * only loads the runs and workflows, the labelling rules stay testable without Nitro.
 *
 * One row per (item key, workflow); a run may label several decision nodes at once.
 * Labels, strongest first:
 * - `human`: a decision the user answered in a human check.
 * - `confirmed`: a sure decision of a run the user accepted; its output led to the
 *   actions that were approved.
 * - `rejected`: the single sure decision of a run the user rejected. The target is
 *   "anything but that answer", written as a `gold` distribution.
 * - `ai`: a sure AI-fallback answer, only when explicitly requested. Off by default,
 *   because Laya would also learn the AI's mistakes.
 */

export type LayaTrainingLabel = 'human' | 'confirmed' | 'rejected' | 'ai'

export type LayaSkipReason
  = | 'workflow-gone'
    | 'node-gone'
    | 'output-gone'
    | 'rejected-multi-node'
    | 'no-alternative'
    | 'empty-state'

export const LAYA_SKIP_REASONS = [
  'workflow-gone',
  'node-gone',
  'output-gone',
  'rejected-multi-node',
  'no-alternative',
  'empty-state'
] as const satisfies readonly LayaSkipReason[]

/** One row in the shape `laya/train.py` `items_from_rows` reads */
export interface LayaTrainingRow {
  state: string
  questions: Record<string, LayaQuestion>
  /** A choice label, or true/false for a noul question; never together with `gold` on one qid */
  expected?: Record<string, string | boolean>
  /** A distribution over the rejected answer's alternatives, keyed by label or `true`/`false` */
  gold?: Record<string, { probabilities: Record<string, number> }>
  meta: {
    run: string
    workflow: string
    /** The first labelled node, so a row with several questions still names where it came from */
    node: string
    source: LayaTrainingLabel
  }
}

export interface LayaTrainingStats {
  rows: number
  labels: Record<LayaTrainingLabel, number>
  skipped: Record<LayaSkipReason, number>
}

export interface LayaTrainingOptions {
  /** Also label sure AI-fallback answers, regardless of the run's feedback */
  ai?: boolean
}

export type LayaSplit = 'train' | 'eval'

/** Whether a run path step is a decision step, even if its node has since been deleted */
function isDecisionStep(step: WorkflowPathStep): boolean {
  return step.source !== undefined
    || step.answer !== undefined
    || step.review !== undefined
    || Boolean(step.attempts?.length)
}

function decisionNode(workflow: AutomationWorkflow, nodeId: string): Extract<WorkflowNode, { type: 'decision' }> | undefined {
  const node = workflow.graph.nodes.find(candidate => candidate.id === nodeId)
  return node?.type === 'decision' ? node : undefined
}

/**
 * Whether an output is a real answer of the current node: one of its options (an
 * explicit `other` included), or `yes`/`no` for a noul question. `other` appended
 * only as a catch-all, and `unsure`, are not answers a model should be taught.
 */
function isSureOutput(node: Extract<WorkflowNode, { type: 'decision' }>, output: string): boolean {
  if (node.data.question === 'choice') {
    return Object.prototype.hasOwnProperty.call(node.data.options, output)
  }
  return output === 'yes' || output === 'no'
}

function expectedTarget(node: Extract<WorkflowNode, { type: 'decision' }>, output: string): string | boolean {
  return node.data.question === 'choice' ? output : output === 'yes'
}

/**
 * The rejected label: every other option shares the probability mass. A noul
 * question has exactly one alternative, so the target is the opposite boolean.
 */
function rejectedTarget(node: Extract<WorkflowNode, { type: 'decision' }>, output: string): Record<string, number> | undefined {
  if (node.data.question === 'yesno') {
    return output === 'yes' ? { true: 0, false: 1 } : { true: 1, false: 0 }
  }

  const alternatives = Object.keys(node.data.options).filter(option => option !== output)
  if (!alternatives.length) {
    return undefined
  }

  const probability = 1 / alternatives.length
  return Object.fromEntries(alternatives.map(option => [option, probability]))
}

/** The label a step contributes, after the per-(run, node) priority; undefined when it contributes none */
function labelFor(
  run: AutomationRun,
  step: WorkflowPathStep,
  singleDecision: boolean,
  ai: boolean
): LayaTrainingLabel | undefined {
  if (step.source === 'human') {
    return 'human'
  }
  if (run.feedback === 'accepted') {
    return 'confirmed'
  }
  if (run.feedback === 'rejected' && singleDecision) {
    return 'rejected'
  }
  if (ai && step.source === 'ai') {
    return 'ai'
  }
  return undefined
}

function timestamp(value: string): number {
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

/**
 * One run per (item key, workflow): the newest wins, so repeated evaluations of the
 * same item do not become several training rows. A duplicated run id is kept once.
 */
function newestRuns(runs: AutomationRun[]): AutomationRun[] {
  const unique = new Map<string, AutomationRun>()
  for (const run of runs) {
    const known = unique.get(run.id)
    if (!known || timestamp(run.at) > timestamp(known.at)) {
      unique.set(run.id, run)
    }
  }

  const sorted = [...unique.values()].sort((a, b) => timestamp(b.at) - timestamp(a.at) || b.id.localeCompare(a.id))
  const seen = new Set<string>()

  return sorted.filter((run) => {
    const key = `${run.workflow}\u0000${run.itemKey}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

/** The rows and the counts the download reports */
export function layaTrainingRows(
  runs: AutomationRun[],
  workflows: AutomationWorkflow[],
  options: LayaTrainingOptions = {}
): { rows: LayaTrainingRow[], stats: LayaTrainingStats } {
  const ai = options.ai ?? false
  const byWorkflow = new Map(workflows.map(workflow => [workflow.id, workflow]))
  const skipped = Object.fromEntries(LAYA_SKIP_REASONS.map(reason => [reason, 0])) as Record<LayaSkipReason, number>
  const stats: LayaTrainingStats = {
    rows: 0,
    labels: { human: 0, confirmed: 0, rejected: 0, ai: 0 },
    skipped
  }
  const rows: LayaTrainingRow[] = []

  for (const run of newestRuns(runs)) {
    const decisionSteps = run.path.filter(isDecisionStep)
    if (!decisionSteps.length) {
      continue
    }
    if (!run.item.state.trim()) {
      stats.skipped['empty-state']++
      continue
    }

    const singleDecision = decisionSteps.length === 1
    if (run.feedback === 'rejected' && !singleDecision) {
      // With several decisions there is no way to tell which one the rejection was about
      stats.skipped['rejected-multi-node']++
    }

    const workflow = byWorkflow.get(run.workflow)
    const questions: Record<string, LayaQuestion> = {}
    const expected: Record<string, string | boolean> = {}
    const gold: Record<string, { probabilities: Record<string, number> }> = {}
    let primary: LayaTrainingRow['meta'] | undefined

    for (const step of decisionSteps) {
      if (step.output === 'review' || step.review) {
        continue
      }

      const label = labelFor(run, step, singleDecision, ai)
      if (!label) {
        continue
      }
      if (!workflow) {
        stats.skipped['workflow-gone']++
        continue
      }

      const node = decisionNode(workflow, step.nodeId)
      if (!node) {
        stats.skipped['node-gone']++
        continue
      }
      if (!isSureOutput(node, step.output)) {
        stats.skipped['output-gone']++
        continue
      }

      const qid = `${workflow.id}:${node.id}`
      if (label === 'rejected') {
        const probabilities = rejectedTarget(node, step.output)
        if (!probabilities) {
          stats.skipped['no-alternative']++
          continue
        }
        gold[qid] = { probabilities }
      } else {
        expected[qid] = expectedTarget(node, step.output)
      }

      questions[qid] = toLayaQuestions({ [qid]: questionForNode(node) })[qid]!
      stats.labels[label]++
      primary ??= { run: run.id, workflow: run.workflow, node: node.id, source: label }
    }

    if (!primary) {
      continue
    }

    rows.push({
      state: run.item.state,
      questions,
      ...(Object.keys(expected).length ? { expected } : {}),
      ...(Object.keys(gold).length ? { gold } : {}),
      meta: primary
    })
  }

  stats.rows = rows.length
  return { rows, stats }
}

/** FNV-1a of the item key, mapped into [0, 1) */
function hashUnit(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) / 0x1_0000_0000
}

/**
 * A deterministic train/eval split by item key: repeated downloads agree and the
 * two files never share an item. `evalShare` is clamped to the useful range.
 */
export function splitOf(itemKey: string, evalShare = 0.1): LayaSplit {
  const share = Number.isFinite(evalShare) ? Math.min(Math.max(evalShare, 0), 1) : 0
  if (share <= 0) {
    return 'train'
  }
  return hashUnit(itemKey) < share ? 'eval' : 'train'
}
