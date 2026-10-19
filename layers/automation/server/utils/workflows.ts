import { randomUUID } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import { z } from 'zod'
import type { AutomationWorkflow, AutomationWorkflowInput, WorkflowGraph } from '../../shared/types/automation'
import { createDefaultGraph, validateWorkflow } from '../../shared/workflow'
import { MAX_EXTRACT_PATTERN_LENGTH, VARIABLE_NAME_RE } from '../../shared/extractors'
import { automationWorkflows } from '../db/schema'
import type { AutomationWorkflowRow } from '../db/schema'
import { forgetWorkflowRuns } from './runs'

export type { AutomationWorkflowRow }

const nodeIdSchema = z.string().regex(/^[a-z0-9_-]{1,64}$/i, 'Invalid node id')
const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() })

export const automationConditionSchema = z.object({
  field: z.enum(['from', 'listId', 'subject', 'text', 'correspondent', 'title']),
  op: z.enum(['contains', 'equals', 'matches']),
  value: z.string().trim().min(1).max(500)
})

export const automationConditionsSchema = z.object({
  combine: z.enum(['all', 'any']),
  conditions: z.array(automationConditionSchema).max(20)
})

export const automationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move-to'), folder: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal('label'), label: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal('mark-read') }),
  z.object({ type: z.literal('star') }),
  z.object({ type: z.literal('trash') }),
  z.object({ type: z.literal('add-tag'), tag: z.number().int().positive() }),
  z.object({ type: z.literal('set-correspondent'), correspondent: z.number().int().positive() }),
  z.object({ type: z.literal('set-type'), documentType: z.number().int().positive() }),
  // Generic actions: bounded like the shared validation, so a graph that the
  // builder and the engine accept is never rejected at the API boundary.
  z.object({
    type: z.literal('extract'),
    variable: z.string().regex(VARIABLE_NAME_RE, 'Invalid variable name'),
    extractor: z.enum(['login-code', 'regex']),
    pattern: z.string().max(MAX_EXTRACT_PATTERN_LENGTH).optional(),
    source: z.enum(['text', 'subject']).optional()
  }),
  z.object({
    type: z.literal('notify'),
    title: z.string().max(300),
    body: z.string().max(2000).optional(),
    modal: z.object({
      title: z.string().trim().max(300).optional(),
      text: z.string().max(4000),
      copy: z.boolean().optional(),
      expiresInMinutes: z.number().int().positive().max(1440).optional()
    }).optional()
  })
])

const triggerNodeSchema = z.object({
  id: nodeIdSchema,
  type: z.literal('trigger'),
  position: positionSchema,
  data: z.object({ kind: z.literal('new-item'), mailbox: z.string().trim().min(1).max(200) })
})

const conditionNodeSchema = z.object({
  id: nodeIdSchema,
  type: z.literal('condition'),
  position: positionSchema,
  data: z.object({ conditions: automationConditionsSchema })
})

const decisionFallbackSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ai'), model: z.string().trim().max(200).optional() }),
  z.object({ type: z.literal('human') })
])

const decisionFallbacksSchema = z.array(decisionFallbackSchema).max(10).optional()

const choiceDecisionNodeSchema = z.object({
  id: nodeIdSchema,
  type: z.literal('decision'),
  position: positionSchema,
  data: z.object({
    question: z.literal('choice'),
    instructions: z.string().trim().min(1).max(1000),
    options: z.record(z.string().trim().min(1).max(60), z.string().trim().min(1).max(200))
      .refine(options => Object.keys(options).length >= 1 && Object.keys(options).length <= 100, {
        message: 'A choice needs between 1 and 100 options'
      }),
    thresholds: z.record(z.string(), z.number().min(0).max(1)),
    fallbacks: decisionFallbacksSchema
  })
})

const yesnoDecisionNodeSchema = z.object({
  id: nodeIdSchema,
  type: z.literal('decision'),
  position: positionSchema,
  data: z.object({
    question: z.literal('yesno'),
    instructions: z.string().trim().min(1).max(1000),
    thresholds: z.object({ yes: z.number().min(0).max(1), no: z.number().min(0).max(1) }),
    fallbacks: decisionFallbacksSchema
  })
})

const actionNodeSchema = z.object({
  id: nodeIdSchema,
  type: z.literal('action'),
  position: positionSchema,
  data: z.object({ action: automationActionSchema })
})

const endNodeSchema = z.object({
  id: nodeIdSchema,
  type: z.literal('end'),
  position: positionSchema,
  data: z.object({})
})

export const workflowNodeSchema = z.union([
  triggerNodeSchema,
  conditionNodeSchema,
  choiceDecisionNodeSchema,
  yesnoDecisionNodeSchema,
  actionNodeSchema,
  endNodeSchema
])

export const workflowEdgeSchema = z.object({
  id: z.string().trim().min(1).max(80),
  source: nodeIdSchema,
  sourceHandle: z.string().trim().min(1).max(80),
  target: nodeIdSchema
})

export const workflowGraphSchema = z.object({
  version: z.literal(1),
  nodes: z.array(workflowNodeSchema).min(1).max(200),
  edges: z.array(workflowEdgeSchema).max(400)
})

export const automationWorkflowInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  domain: z.enum(['mail', 'documents']),
  service: z.string().trim().min(1).max(80).nullable(),
  enabled: z.boolean(),
  mode: z.enum(['suggest', 'auto']),
  graph: workflowGraphSchema
})

export const automationWorkflowPatchSchema = automationWorkflowInputSchema.partial()

export const automationWorkflowCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  domain: z.enum(['mail', 'documents']),
  service: z.string().trim().min(1).max(80).nullable().default(null),
  enabled: z.boolean().default(true),
  mode: z.enum(['suggest', 'auto']).default('suggest'),
  /** A builder sends the draft it edited; without one a fresh default graph is used */
  graph: workflowGraphSchema.optional()
})

const previewSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('recent'), limit: z.number().int().min(1).max(50).optional() }),
  z.object({ kind: z.literal('item'), ref: z.string().trim().min(1).max(400) }),
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(20_000) })
])

/** A dry run: the graph, the domain it belongs to and where to take items from */
export const workflowPreviewSchema = z.object({
  graph: workflowGraphSchema,
  domain: z.enum(['mail', 'documents']),
  service: z.string().trim().min(1).max(80).nullable(),
  source: previewSourceSchema
})

/** Rejects a graph that does not validate, with the first error as the message */
export function assertValidGraph(graph: WorkflowGraph, domain: 'mail' | 'documents') {
  const errors = validateWorkflow(graph, domain)
  if (errors.length) {
    throw createError({ status: 400, statusText: errors[0]!.message })
  }
}

export function toAutomationWorkflow(row: AutomationWorkflowRow): AutomationWorkflow {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    service: row.service,
    enabled: row.enabled,
    mode: row.mode,
    position: row.position,
    graph: row.graph,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export async function listWorkflows(domain?: 'mail' | 'documents'): Promise<AutomationWorkflow[]> {
  const rows = await (await useDb()).select().from(automationWorkflows)
    .where(domain ? eq(automationWorkflows.domain, domain) : undefined)
    .orderBy(asc(automationWorkflows.position), asc(automationWorkflows.createdAt))

  return rows.map(toAutomationWorkflow)
}

export async function getWorkflow(id: string): Promise<AutomationWorkflow> {
  const row = await (await useDb()).select().from(automationWorkflows).where(eq(automationWorkflows.id, id)).get()
  if (!row) {
    throw createError({ status: 404, statusText: 'Workflow not found' })
  }
  return toAutomationWorkflow(row)
}

async function nextPosition(): Promise<number> {
  const row = await (await useDb()).select({ value: sql<number>`coalesce(max(${automationWorkflows.position}), -1)` })
    .from(automationWorkflows).get()
  return (row?.value ?? -1) + 1
}

/**
 * Inserts a workflow with a graph that is already built. Templates use this: they
 * are stored disabled and in suggest mode, with the graph exactly as instantiated
 * (an unresolved document type stays invalid until the user picks one).
 */
export async function insertWorkflow(input: AutomationWorkflowInput): Promise<AutomationWorkflow> {
  const now = new Date()

  const [row] = await (await useDb()).insert(automationWorkflows).values({
    id: randomUUID(),
    name: input.name,
    domain: input.domain,
    service: input.service,
    enabled: input.enabled,
    mode: input.mode,
    position: await nextPosition(),
    graph: input.graph,
    createdAt: now,
    updatedAt: now
  }).returning()

  return toAutomationWorkflow(row!)
}

export async function createWorkflow(input: z.infer<typeof automationWorkflowCreateSchema>): Promise<AutomationWorkflow> {
  const graph = input.graph ?? createDefaultGraph(input.domain)
  assertValidGraph(graph, input.domain)

  return insertWorkflow({ ...input, graph })
}

export async function updateWorkflow(id: string, patch: Partial<AutomationWorkflowInput>): Promise<AutomationWorkflow> {
  const existing = await getWorkflow(id)
  const merged = { ...existing, ...patch }
  assertValidGraph(merged.graph, merged.domain)

  const [row] = await (await useDb()).update(automationWorkflows).set({
    name: merged.name,
    domain: merged.domain,
    service: merged.service,
    enabled: merged.enabled,
    mode: merged.mode,
    graph: merged.graph,
    updatedAt: new Date()
  }).where(eq(automationWorkflows.id, id)).returning()

  return toAutomationWorkflow(row!)
}

export async function removeWorkflow(id: string): Promise<void> {
  const [removed] = await (await useDb()).delete(automationWorkflows).where(eq(automationWorkflows.id, id)).returning()
  if (!removed) {
    throw createError({ status: 404, statusText: 'Workflow not found' })
  }

  // The workflow is gone; its pending suggestions can never be applied. The runs
  // it already produced stay in the activity log under the workflow's last name.
  await forgetWorkflowRuns(id, removed.name).catch((error) => {
    // The workflow itself is already deleted; failing here would only make the
    // caller think the delete failed
    console.warn('[automation] Could not clean up the deleted workflow runs', { workflow: id, error: String(error) })
  })
}

/** Persists a new order; every id must exist, none may be repeated */
export async function reorderWorkflows(ids: string[]): Promise<AutomationWorkflow[]> {
  if (new Set(ids).size !== ids.length) {
    throw createError({ status: 400, statusText: 'The workflow order contains duplicates' })
  }

  const db = await useDb()
  await db.transaction(async (tx) => {
    for (const [position, id] of ids.entries()) {
      const [updated] = await tx.update(automationWorkflows).set({ position, updatedAt: new Date() })
        .where(eq(automationWorkflows.id, id)).returning()
      if (!updated) {
        throw createError({ status: 404, statusText: `Workflow "${id}" not found` })
      }
    }
  })

  return listWorkflows()
}
