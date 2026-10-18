import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type {
  AppliedAction,
  AutomationDomain,
  AutomationFeedback,
  AutomationItem,
  AutomationOutcome,
  DecisionAnswer,
  PlannedAction,
  WorkflowPathStep
} from '../../shared/types/automation'

// Rebuildable automation cache. The workflows live in the main database; runs are
// high-volume and pruned, so they get their own SQLite file.

/** One workflow run over one item, with the path taken and what was decided/applied */
export const automationRuns = sqliteTable('automation_runs', {
  id: text('id').primaryKey(),
  workflow: text('workflow').notNull(),
  /** Copied so a run stays readable after the workflow is renamed or deleted */
  workflowName: text('workflow_name').notNull(),
  domain: text('domain', { enum: ['mail', 'documents'] }).$type<AutomationDomain>().notNull(),
  service: text('service').notNull(),
  itemKey: text('item_key').notNull(),
  /** The item snapshot the apply/undo steps need */
  item: text('item', { mode: 'json' }).$type<AutomationItem>().notNull(),
  /** The nodes the run walked, in order */
  path: text('path', { mode: 'json' }).$type<WorkflowPathStep[]>().notNull(),
  /** The engine's answer per decision node */
  answers: text('answers', { mode: 'json' }).$type<Record<string, DecisionAnswer>>().notNull(),
  outcome: text('outcome', { enum: ['suggested', 'applied', 'failed', 'undone', 'skipped'] })
    .$type<AutomationOutcome>().notNull(),
  /** The actions the workflow planned; a suggestion carries them until it is applied */
  actions: text('actions', { mode: 'json' }).$type<PlannedAction[]>().notNull(),
  /** What was actually applied, with the information a reversal needs */
  applied: text('applied', { mode: 'json' }).$type<AppliedAction[]>().notNull(),
  error: text('error'),
  /** A user's reaction; the labelled examples the corrections export reads */
  feedback: text('feedback', { enum: ['accepted', 'rejected'] }).$type<AutomationFeedback>(),
  at: integer('at', { mode: 'timestamp_ms' }).notNull()
}, table => [
  index('automation_runs_at_idx').on(table.at),
  index('automation_runs_domain_at_idx').on(table.domain, table.at),
  index('automation_runs_outcome_idx').on(table.outcome)
])

/** Each item is evaluated once per (domain, service); the row is written before the run */
export const automationSeen = sqliteTable('automation_seen', {
  domain: text('domain', { enum: ['mail', 'documents'] }).$type<AutomationDomain>().notNull(),
  service: text('service').notNull(),
  itemKey: text('item_key').notNull(),
  /** Failed attempts so far; 0 once the item was evaluated successfully */
  attempts: integer('attempts').notNull().default(0),
  /**
   * When to try again after a transient failure. Null means the item is final:
   * either evaluated (attempts 0) or given up (attempts at the cap).
   */
  nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }),
  at: integer('at', { mode: 'timestamp_ms' }).notNull()
}, table => [
  primaryKey({ columns: [table.domain, table.service, table.itemKey] }),
  index('automation_seen_next_attempt_idx').on(table.nextAttemptAt)
])

/**
 * How far the scheduler's safety-net sweep has looked per (domain, service): the
 * `added` timestamp of the newest document, or the date of the newest mail.
 */
export const automationSweep = sqliteTable('automation_sweep', {
  domain: text('domain', { enum: ['mail', 'documents'] }).$type<AutomationDomain>().notNull(),
  service: text('service').notNull(),
  /** ISO timestamp of the newest item the sweep has fed to the engine */
  cursor: text('cursor'),
  at: integer('at', { mode: 'timestamp_ms' }).notNull()
}, table => [
  primaryKey({ columns: [table.domain, table.service] })
])

export type AutomationRunRow = typeof automationRuns.$inferSelect
