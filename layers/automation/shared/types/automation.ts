/**
 * The automation domain: a workflow of nodes that watches new mail and documents
 * and applies actions, optionally after a local AI decision. The types here are
 * shared by the server (workflows, executor, runs) and the UI (visual builder,
 * preview, activity).
 */

export type AutomationDomain = 'mail' | 'documents'

/** `suggest` only records what a workflow would do; `auto` applies it */
export type AutomationMode = 'suggest' | 'auto'

// --- Conditions -----------------------------------------------------------

/** The item fields a classic condition may test */
export type ConditionField = 'from' | 'subject' | 'text' | 'correspondent' | 'title'

export type ConditionOperator = 'contains' | 'equals' | 'matches'

/** How several conditions combine */
export type ConditionCombine = 'all' | 'any'

export interface AutomationCondition {
  field: ConditionField
  op: ConditionOperator
  value: string
}

export interface AutomationConditions {
  combine: ConditionCombine
  conditions: AutomationCondition[]
}

// --- AI decision ----------------------------------------------------------

/**
 * A question for the decision engine. Mirrors what the engine answers: a choice
 * among `options` (option key -> description), or a yes/no question.
 */
export type DecisionQuestion
  = | { type: 'choice', instructions: string, options: Record<string, string> }
    | { type: 'yesno', instructions: string }

/**
 * One answer. `confidence` is the engine's calibrated confidence (0..1) for the
 * answer it gave; `yes` is P(true) for a yes/no question; `scores` are the
 * engine's per-option probabilities where it reports them (Laya does for choice).
 */
export interface DecisionAnswer {
  choice?: string
  yes?: number
  confidence: number
  scores?: Record<string, number>
}

/**
 * A rule's decision output names: every option key plus `other` for a choice, or
 * `yes`/`no`/`unsure` for a yes/no question.
 */
export const CHOICE_OTHER = 'other'
export const YESNO_OUTPUTS = ['yes', 'no', 'unsure'] as const
export type YesNoOutput = typeof YESNO_OUTPUTS[number]

// --- Actions --------------------------------------------------------------

export type MailAction
  = | { type: 'move-to', folder: string }
    | { type: 'label', label: string }
    | { type: 'mark-read' }
    | { type: 'star' }

export type DocumentsAction
  = | { type: 'add-tag', tag: number }
    | { type: 'set-correspondent', correspondent: number }
    | { type: 'set-type', documentType: number }

export type AutomationAction = MailAction | DocumentsAction

// --- Workflow graph -------------------------------------------------------

/** The trigger node: exactly one per workflow */
export interface TriggerNodeData {
  kind: 'new-item'
  /** Mail: the mailbox the trigger watches; documents: `INBOX` by convention */
  mailbox: string
}

export interface ConditionNodeData {
  conditions: AutomationConditions
}

/** A decision asks one question; its outputs branch on the answer and a threshold */
export type DecisionNodeData
  = | { question: 'choice', instructions: string, options: Record<string, string>, thresholds: Record<string, number> }
    | { question: 'yesno', instructions: string, thresholds: { yes: number, no: number } }

export interface ActionNodeData {
  action: AutomationAction
}

export interface WorkflowNodeBase {
  id: string
  /** Canvas position, persisted in the graph */
  position: { x: number, y: number }
}

export type WorkflowNode
  = | (WorkflowNodeBase & { type: 'trigger', data: TriggerNodeData })
    | (WorkflowNodeBase & { type: 'condition', data: ConditionNodeData })
    | (WorkflowNodeBase & { type: 'decision', data: DecisionNodeData })
    | (WorkflowNodeBase & { type: 'action', data: ActionNodeData })
    | (WorkflowNodeBase & { type: 'end', data: Record<string, never> })

export type WorkflowNodeType = WorkflowNode['type']

/** An edge leaves one node output (`sourceHandle`) and enters one node */
export interface WorkflowEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
}

/** The workflow's graph; versioned so it can evolve */
export interface WorkflowGraph {
  version: 1
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

/** One step the executor walked: the node, the output it left, and its answer when it asked one */
export interface WorkflowPathStep {
  nodeId: string
  output: string
  answer?: DecisionAnswer
}

/** One action the workflow planned, with the node that produced it */
export interface PlannedAction {
  nodeId: string
  action: AutomationAction
}

// --- Workflows ------------------------------------------------------------

export interface AutomationWorkflow {
  id: string
  name: string
  domain: AutomationDomain
  /** A service id, or null to mean every service of the domain */
  service: string | null
  enabled: boolean
  mode: AutomationMode
  /** Lower runs first; the first workflow wins per action type */
  position: number
  graph: WorkflowGraph
  createdAt: string
  updatedAt: string
}

export interface AutomationWorkflowInput {
  name: string
  domain: AutomationDomain
  service: string | null
  enabled: boolean
  mode: AutomationMode
  graph: WorkflowGraph
}

// --- Items ----------------------------------------------------------------

/**
 * The snapshot of an item a run was evaluated against; carries everything the
 * apply and undo steps need without re-reading the provider.
 */
export interface AutomationItem {
  domain: AutomationDomain
  service: string
  /** Stable key: mail `mailbox|uid|messageId`, documents the id as a string */
  key: string
  /** Mail only */
  mailbox?: string
  uid?: number
  /** Mail only */
  messageId?: string
  /** Documents only */
  documentId?: number
  /** Mail flags at the time of the run, for mark-read/star undo */
  unread?: boolean
  flagged?: boolean
  /** The condition fields, already resolved to text */
  fields: Partial<Record<ConditionField, string>>
  /** The text the decision engine reads */
  state: string
  /** Human readable title, for the preview and the activity list */
  title: string
}

// --- Runs -----------------------------------------------------------------

/** One action as it was actually applied, carrying what a reversal needs */
export type AppliedAction
  = | { type: 'move-to', folder: string, from: string, uid?: number }
    | { type: 'label', label: string, labelMailbox: string, uid?: number }
    | { type: 'mark-read', mailbox: string, uid: number, wasUnread: boolean }
    | { type: 'star', mailbox: string, uid: number, wasFlagged: boolean }
    | { type: 'add-tag', document: number, tag: number, previousTags: number[] }
    | { type: 'set-correspondent', document: number, correspondent: number, previous: number | null }
    | { type: 'set-type', document: number, documentType: number, previous: number | null }

/** A single reversal step; planned from the applied actions */
export type UndoOperation
  = | { op: 'move', mailbox: string, uid: number, target: string }
    | { op: 'delete', mailbox: string, uid: number }
    | { op: 'set-seen', mailbox: string, uid: number, seen: boolean }
    | { op: 'set-flagged', mailbox: string, uid: number, flagged: boolean }
    | { op: 'set-tags', document: number, tags: number[] }
    | { op: 'set-correspondent', document: number, correspondent: number | null }
    | { op: 'set-document-type', document: number, documentType: number | null }

export type AutomationOutcome = 'suggested' | 'applied' | 'failed' | 'undone' | 'skipped'

/** A user's reaction to a suggestion; kept as a labelled example for fine-tuning */
export type AutomationFeedback = 'accepted' | 'rejected'

/** One stored run, as the activity list shows it */
export interface AutomationRun {
  id: string
  workflow: string
  workflowName: string
  domain: AutomationDomain
  service: string
  itemKey: string
  item: AutomationItem
  /** The nodes the run walked, in order */
  path: WorkflowPathStep[]
  /** The engine's answer per decision node */
  answers: Record<string, DecisionAnswer>
  outcome: AutomationOutcome
  /** The actions the workflow planned; a suggestion carries them until applied */
  actions: PlannedAction[]
  /** What was actually applied, with the information a reversal needs */
  applied: AppliedAction[]
  error?: string
  feedback?: AutomationFeedback
  at: string
}

// --- Preview --------------------------------------------------------------

/** One previewed item; nothing is applied */
export interface WorkflowPreviewItem {
  /** Entity key (`mail:svc:INBOX/1`, `document:svc:42`) */
  ref: string
  title: string
  path: WorkflowPathStep[]
  /** Answers per decision node id */
  answers: Record<string, DecisionAnswer>
  actions: PlannedAction[]
}

/** Where a preview takes its items from */
export type WorkflowPreviewSource
  = | { kind: 'recent', limit?: number }
    | { kind: 'item', ref: string }
    | { kind: 'text', text: string }

export interface WorkflowPreviewRequest {
  graph: WorkflowGraph
  domain: AutomationDomain
  service: string | null
  source: WorkflowPreviewSource
}

export interface WorkflowPreviewResult {
  items: WorkflowPreviewItem[]
  /** True when a decision node was reached but no engine is configured */
  aiUnavailable: boolean
}

/** One labelled example for a future Laya fine-tune */
export interface CorrectionExample {
  state: string
  domain: string
  service: string
  workflow: string
  workflowName: string
  answers: Record<string, DecisionAnswer>
  actions: PlannedAction[]
  /** accepted = the suggestion was right, rejected = it was not */
  feedback: AutomationFeedback
}
