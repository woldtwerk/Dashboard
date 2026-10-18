import type {
  AppliedAction,
  AutomationAction,
  AutomationCondition,
  AutomationConditions,
  AutomationItem,
  AutomationRun,
  CorrectionExample,
  DecisionAnswer,
  PlannedAction,
  UndoOperation
} from './types/automation'

// --- Conditions -----------------------------------------------------------

/** Whether one condition holds; a missing field never matches */
export function matchesCondition(value: string | undefined, condition: AutomationCondition): boolean {
  if (value === undefined || value === null) {
    return false
  }

  const haystack = value.toLocaleLowerCase()
  const needle = condition.value.toLocaleLowerCase()

  switch (condition.op) {
    case 'contains':
      return needle === '' || haystack.includes(needle)
    case 'equals':
      return haystack === needle
    case 'matches': {
      if (needle === '') {
        return false
      }
      try {
        // Case-insensitive, and only a match of the user's pattern; the value is data
        return new RegExp(condition.value, 'i').test(value)
      } catch {
        // An invalid pattern is not a silent "everything matches"
        return false
      }
    }
  }
}

/**
 * Whether the condition block holds. No conditions match everything, so a node can
 * be driven by the AI question alone; otherwise `all`/`any` decides. A condition
 * with an empty value is ignored, so a half-typed row does not change the result.
 */
export function matchesConditions(item: AutomationItem, conditions: AutomationConditions): boolean {
  const list = conditions.conditions.filter(condition => condition.value !== '')
  if (!list.length) {
    return true
  }

  const results = list.map(condition => matchesCondition(item.fields[condition.field], condition))
  return conditions.combine === 'any' ? results.some(Boolean) : results.every(Boolean)
}

// --- Cross-workflow action selection --------------------------------------

/**
 * Picks the actions of the triggered workflows in order: workflows run by position
 * and the first to offer an action type owns it, so a later workflow cannot move
 * the same mail a second time. Returns the chosen actions with their workflow.
 */
export function selectActions(
  workflows: Array<{ id: string, actions: PlannedAction[] }>
): Array<{ workflow: string, nodeId: string, action: AutomationAction }> {
  const seen = new Set<string>()
  const chosen: Array<{ workflow: string, nodeId: string, action: AutomationAction }> = []

  for (const { id, actions } of workflows) {
    for (const planned of actions) {
      if (seen.has(planned.action.type)) {
        continue
      }
      seen.add(planned.action.type)
      chosen.push({ workflow: id, nodeId: planned.nodeId, action: planned.action })
    }
  }

  return chosen
}

// --- Item text ------------------------------------------------------------

/** Longest body handed to the decision engine; the server accepts far more, but decisions don't need it */
export const AUTOMATION_STATE_BODY_CHARS = 4000

function cap(body: string): string {
  const trimmed = body.trim()
  return trimmed.length > AUTOMATION_STATE_BODY_CHARS ? `${trimmed.slice(0, AUTOMATION_STATE_BODY_CHARS)}…` : trimmed
}

/** The text a mail decision reads: sender, subject and body */
export function buildMailState(from: string, subject: string, body: string): string {
  return [`From: ${from}`, `Subject: ${subject}`, '', cap(body)].join('\n')
}

/** The text a document decision reads: title and extracted content */
export function buildDocumentState(title: string, content: string): string {
  return [`Title: ${title}`, '', cap(content)].join('\n')
}

// --- Undo -----------------------------------------------------------------

/**
 * The reversal of the applied actions, planned from what the apply step recorded.
 * Actions are reversed last-first (a label added after a move is removed before the
 * move is undone). An action with nothing to reverse contributes no step.
 */
export function planUndo(applied: AppliedAction[]): UndoOperation[] {
  const operations: UndoOperation[] = []

  for (const action of [...applied].reverse()) {
    switch (action.type) {
      case 'move-to':
        if (action.uid !== undefined) {
          operations.push({ op: 'move', mailbox: action.folder, uid: action.uid, target: action.from })
        }
        break
      case 'label':
        if (action.uid !== undefined) {
          operations.push({ op: 'delete', mailbox: action.labelMailbox, uid: action.uid })
        }
        break
      case 'mark-read':
        // The record exists only when the run set the flag, so the inverse is to clear it
        operations.push({ op: 'set-seen', mailbox: action.mailbox, uid: action.uid, seen: false })
        break
      case 'star':
        operations.push({ op: 'set-flagged', mailbox: action.mailbox, uid: action.uid, flagged: false })
        break
      case 'add-tag':
        operations.push({ op: 'set-tags', document: action.document, tags: action.previousTags })
        break
      case 'set-correspondent':
        operations.push({ op: 'set-correspondent', document: action.document, correspondent: action.previous })
        break
      case 'set-type':
        operations.push({ op: 'set-document-type', document: action.document, documentType: action.previous })
        break
    }
  }

  return operations
}

// --- Corrections ----------------------------------------------------------

/** Backoff between evaluation retries, in minutes: 1, 5, 30 */
export const AUTOMATION_RETRY_MINUTES = [1, 5, 30] as const

/**
 * When to retry an item whose evaluation failed transiently. `attempts` is the
 * number of the attempt that just failed (1-based); `null` means give up.
 */
export function nextAttempt(attempts: number, now: Date): Date | null {
  const minutes = AUTOMATION_RETRY_MINUTES[attempts - 1]
  return minutes === undefined ? null : new Date(now.getTime() + minutes * 60_000)
}

/** The attempts after which an item is given up (one past the last retry) */
export const AUTOMATION_MAX_ATTEMPTS = AUTOMATION_RETRY_MINUTES.length + 1

/** The highest confidence among a run's answers; the activity list shows it */
export function runConfidence(answers: Record<string, DecisionAnswer>): number | undefined {
  const values = Object.values(answers).map(answer => answer.confidence).filter(value => Number.isFinite(value))
  return values.length ? Math.max(...values) : undefined
}

/** Maps a reacted-to run to a fine-tune example; only corrected runs reach this */
export function toCorrectionExample(run: AutomationRun): CorrectionExample {
  return {
    state: run.item.state,
    domain: run.domain,
    service: run.service,
    workflow: run.workflow,
    workflowName: run.workflowName,
    answers: run.answers,
    actions: run.actions,
    feedback: run.feedback ?? 'rejected'
  }
}
