import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type {
  AppliedAction,
  AutomationDomain,
  AutomationFeedback,
  AutomationItem,
  AutomationOutcome,
  AutomationRun,
  DecisionAnswer,
  PlannedAction,
  WorkflowPathStep
} from '../../shared/types/automation'
import { pendingRunIds } from '../../shared/automation'
import * as cacheSchema from '../db/cache-schema'
import { automationRuns, automationSeen, automationSweep } from '../db/cache-schema'
import type { AutomationRunRow } from '../db/cache-schema'

/** Keep the activity list useful without letting the cache grow forever */
export const AUTOMATION_RETENTION = 5000

export type { AutomationRunRow }

/** The automation cache database; rebuildable, so it lives with the other caches */
export function automationCacheDb() {
  return useCacheDb('automation', cacheSchema)
}

export function toAutomationRun(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    workflow: row.workflow,
    workflowName: row.workflowName,
    domain: row.domain,
    service: row.service,
    itemKey: row.itemKey,
    item: row.item,
    path: row.path,
    answers: row.answers,
    outcome: row.outcome,
    actions: row.actions,
    applied: row.applied,
    error: row.error ?? undefined,
    feedback: row.feedback ?? undefined,
    at: row.at.toISOString()
  }
}

export interface AutomationRunInput {
  id?: string
  workflow: string
  workflowName: string
  domain: AutomationDomain
  service: string
  item: AutomationItem
  path: WorkflowPathStep[]
  answers: Record<string, DecisionAnswer>
  outcome: AutomationOutcome
  actions: PlannedAction[]
  applied?: AppliedAction[]
  error?: string
  at?: Date
}

export async function recordRun(input: AutomationRunInput): Promise<AutomationRun> {
  const id = input.id ?? randomUUID()
  const at = input.at ?? new Date()
  const db = await automationCacheDb()

  const [row] = await db.insert(automationRuns).values({
    id,
    workflow: input.workflow,
    workflowName: input.workflowName,
    domain: input.domain,
    service: input.service,
    itemKey: input.item.key,
    item: input.item,
    path: input.path,
    answers: input.answers,
    outcome: input.outcome,
    actions: input.actions,
    applied: input.applied ?? [],
    error: input.error ?? null,
    feedback: null,
    at
  }).returning()

  // Retention belongs to the same call; a busy or failing delete must not lose the run
  await db.delete(automationRuns).where(sql`${automationRuns.id} NOT IN (
    SELECT id FROM automation_runs ORDER BY at DESC, id DESC LIMIT ${AUTOMATION_RETENTION}
  )`).catch(() => {})

  return toAutomationRun(row!)
}

export async function getRun(id: string): Promise<AutomationRun> {
  const row = await (await automationCacheDb()).select().from(automationRuns).where(eq(automationRuns.id, id)).get()
  if (!row) {
    throw createError({ status: 404, statusText: 'Automation run not found' })
  }
  return toAutomationRun(row)
}

export async function updateRun(id: string, patch: {
  outcome?: AutomationOutcome
  path?: WorkflowPathStep[]
  answers?: Record<string, DecisionAnswer>
  actions?: PlannedAction[]
  applied?: AppliedAction[]
  feedback?: AutomationFeedback | null
  error?: string | null
}): Promise<AutomationRun> {
  const [row] = await (await automationCacheDb()).update(automationRuns).set(patch).where(eq(automationRuns.id, id)).returning()
  if (!row) {
    throw createError({ status: 404, statusText: 'Automation run not found' })
  }
  return toAutomationRun(row)
}

/**
 * Cleans up after a deleted workflow. Its pending suggestions can never be applied
 * and are dropped; every run it already produced stays in the activity log, marked
 * with the workflow's last name. Retry/seen state is keyed per (domain, service),
 * not per workflow, so it is deliberately left alone: dropping it would make the
 * remaining workflows evaluate every item again.
 */
export async function forgetWorkflowRuns(workflow: string, workflowName: string): Promise<void> {
  const db = await automationCacheDb()
  const rows = await db.select({
    id: automationRuns.id,
    workflow: automationRuns.workflow,
    outcome: automationRuns.outcome
  }).from(automationRuns).where(eq(automationRuns.workflow, workflow))

  const pending = pendingRunIds(rows, workflow)
  if (pending.length) {
    await db.delete(automationRuns).where(inArray(automationRuns.id, pending))
  }

  // The name was copied when the run was recorded; refresh it so the activity log
  // reads with the workflow's final name even if it had been renamed.
  await db.update(automationRuns).set({ workflowName }).where(eq(automationRuns.workflow, workflow))
}

export interface AutomationRunQuery {
  domain?: AutomationDomain
  outcome?: AutomationOutcome
  /** Only runs at or after this instant */
  since?: string
  limit: number
}

export async function listRuns(query: AutomationRunQuery): Promise<AutomationRun[]> {
  const rows = await (await automationCacheDb()).select().from(automationRuns)
    .where(and(
      query.domain ? eq(automationRuns.domain, query.domain) : undefined,
      query.outcome ? eq(automationRuns.outcome, query.outcome) : undefined,
      query.since ? gte(automationRuns.at, new Date(query.since)) : undefined
    ))
    .orderBy(desc(automationRuns.at), desc(automationRuns.id))
    .limit(query.limit)

  return rows.map(toAutomationRun)
}

/**
 * How many runs wait for a human answer. One count on the indexed outcome column,
 * so the Activity badges can ask for it on every page without the run payload.
 */
export async function countRunsAwaitingReview(): Promise<number> {
  const [row] = await (await automationCacheDb())
    .select({ count: count() })
    .from(automationRuns)
    .where(eq(automationRuns.outcome, 'review'))

  return row?.count ?? 0
}

/** The runs a user reacted to; the labelled examples a fine-tune export reads */
export async function listCorrections(limit = 1000): Promise<AutomationRun[]> {
  const rows = await (await automationCacheDb()).select().from(automationRuns)
    .where(sql`${automationRuns.feedback} IS NOT NULL`)
    .orderBy(desc(automationRuns.at))
    .limit(limit)

  return rows.map(toAutomationRun)
}

/** One item that still needs evaluating, with how many attempts already failed */
export interface SeenState {
  itemKey: string
  attempts: number
}

/**
 * The keys that still need evaluating: new items, and items whose earlier attempt
 * failed and whose retry is due. An item that was evaluated or given up has no
 * `nextAttemptAt` and is left out.
 */
export async function dueItems(domain: AutomationDomain, service: string, keys: string[], now: Date): Promise<SeenState[]> {
  if (!keys.length) {
    return []
  }

  const rows = await (await automationCacheDb()).select({
    itemKey: automationSeen.itemKey,
    attempts: automationSeen.attempts,
    nextAttemptAt: automationSeen.nextAttemptAt
  }).from(automationSeen)
    .where(and(
      eq(automationSeen.domain, domain),
      eq(automationSeen.service, service),
      inArray(automationSeen.itemKey, keys)
    ))

  const known = new Map(rows.map(row => [row.itemKey, row]))
  const due: SeenState[] = []

  for (const itemKey of keys) {
    const row = known.get(itemKey)
    if (!row) {
      due.push({ itemKey, attempts: 0 })
    } else if (row.nextAttemptAt && row.nextAttemptAt.getTime() <= now.getTime()) {
      due.push({ itemKey, attempts: row.attempts })
    }
  }

  return due
}

/** Marks an item as finally evaluated, so it is never looked at again */
export async function markEvaluated(domain: AutomationDomain, service: string, itemKey: string, now: Date): Promise<void> {
  await (await automationCacheDb()).insert(automationSeen)
    .values({ domain, service, itemKey, attempts: 0, nextAttemptAt: null, at: now })
    .onConflictDoUpdate({
      target: [automationSeen.domain, automationSeen.service, automationSeen.itemKey],
      set: { attempts: 0, nextAttemptAt: null, at: now }
    })
}

/** Records a failed attempt; a null `nextAttemptAt` means the item is given up */
export async function recordAttempt(
  domain: AutomationDomain,
  service: string,
  itemKey: string,
  attempts: number,
  nextAttemptAt: Date | null,
  now: Date
): Promise<void> {
  await (await automationCacheDb()).insert(automationSeen)
    .values({ domain, service, itemKey, attempts, nextAttemptAt, at: now })
    .onConflictDoUpdate({
      target: [automationSeen.domain, automationSeen.service, automationSeen.itemKey],
      set: { attempts, nextAttemptAt, at: now }
    })
}

/** How far the safety-net sweep has looked for one (domain, service) */
export async function readSweepCursor(domain: AutomationDomain, service: string): Promise<string | null> {
  const row = await (await automationCacheDb()).select({ cursor: automationSweep.cursor }).from(automationSweep)
    .where(and(eq(automationSweep.domain, domain), eq(automationSweep.service, service)))
    .get()

  return row?.cursor ?? null
}

export async function writeSweepCursor(domain: AutomationDomain, service: string, cursor: string): Promise<void> {
  const at = new Date()
  await (await automationCacheDb()).insert(automationSweep)
    .values({ domain, service, cursor, at })
    .onConflictDoUpdate({
      target: [automationSweep.domain, automationSweep.service],
      set: { cursor, at }
    })
}
