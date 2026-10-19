import { createError } from 'nuxt/server'
import type {
  AutomationDomain,
  AutomationItem,
  AutomationRun,
  AutomationWorkflow,
  WorkflowPreviewRequest,
  WorkflowPreviewResult
} from '../../shared/types/automation'
import { runDecisionNodesBatch, runWorkflowBatch, validateWorkflow } from '../../shared/workflow'
import type { WorkflowDecide, WorkflowDecideBatch } from '../../shared/workflow'
import { createDocumentsApplier, createMailApplier, toMailActionProvider } from './appliers'
import type { AutomationApplier, AutomationDeps, AutomationLogger } from './engine'
import { applyRunActions, errorMessage, evaluateCandidates, runService, undoPlan } from './engine'
import { sweepAll } from './automation-sweep'
import type { SweepDeps } from './automation-sweep'
import { hasDecisionEngine, useDecisionEngine } from './decision-engine'
import { itemRef, loadDocumentsSince, loadItemByRef, loadItems, loadMailSince, loadRecentItems } from './automation-items'
import { listWorkflows } from './workflows'
import { dueItems, getRun, markEvaluated, readSweepCursor, recordAttempt, recordRun, updateRun, writeSweepCursor } from './runs'

const LOCK_TTL_MS = 5 * 60_000
const PREVIEW_LOCK_TTL_MS = 30_000
/** The preview never looks at more items than this */
const PREVIEW_MAX_ITEMS = 50

/** Just the part of the consola instance the applier and runner need */
function automationLogger(service: string): AutomationLogger {
  const logger = useServiceLogger('automation', service)
  return {
    info: (message, meta) => logger.info(message, meta),
    warn: (message, meta) => logger.warn(message, meta),
    error: (message, meta) => logger.error(message, meta)
  }
}

/** The decision function from the registered engine, or undefined without one */
function workflowDecide(): WorkflowDecide | undefined {
  if (!hasDecisionEngine()) {
    return undefined
  }
  const engine = useDecisionEngine()
  return (state, questions) => engine.decide(state, questions)
}

/** The batch decision function from the registered engine, or undefined without one */
function workflowDecideBatch(): WorkflowDecideBatch | undefined {
  if (!hasDecisionEngine()) {
    return undefined
  }
  const engine = useDecisionEngine()
  return (states, questions) => engine.decideBatch(states, questions)
}

/** Builds the domain applier from the configured provider */
async function applierFor(domain: AutomationDomain, service: string): Promise<AutomationApplier> {
  const logger = automationLogger(service)

  if (domain === 'mail') {
    return createMailApplier({
      provider: toMailActionProvider(await useMailProvider(service)),
      publish: mailbox => publishDomainEvent({ domain: 'mail', service, type: 'changed', resource: mailbox }),
      logger
    })
  }

  return createDocumentsApplier({
    provider: await useDocumentsProvider(service),
    publish: () => publishDomainEvent({ domain: 'documents', service, type: 'changed' }),
    logger
  })
}

/** One suggestion becomes one in-app notification, deduplicated by run */
async function notifySuggestion(run: AutomationRun): Promise<void> {
  const actions = run.actions.map(planned => planned.action.type).join(', ')

  await notify({
    category: 'automation',
    title: `Suggestion: ${run.workflowName}`,
    body: actions ? `${run.item.title} — ${actions}` : run.item.title,
    to: '/automation?tab=activity',
    domain: 'automation',
    service: run.service,
    dedupeKey: `automation:${run.id}`
  })
}

/** A transient failure that ran out of retries becomes a notification too */
async function notifyFailed(domain: AutomationDomain, service: string, item: AutomationItem, error: unknown): Promise<void> {
  await notify({
    category: 'automation',
    title: 'Automation gave up on an item',
    body: `${item.title} — ${error instanceof Error ? error.message : String(error)}`,
    to: '/automation?tab=activity',
    domain: 'automation',
    service,
    dedupeKey: `automation-failed:${domain}:${service}:${item.key}`
  })
}

/** The dependencies the runner uses in the running server */
function automationDeps(service: string): AutomationDeps {
  return {
    store: { due: dueItems, markEvaluated, recordAttempt, record: recordRun },
    decide: workflowDecide(),
    decideBatch: workflowDecideBatch(),
    loadItems: (domain, id, limit) => loadItems(domain, id, limit),
    applierFor,
    notify: notifySuggestion,
    notifyFailed,
    logger: automationLogger(service)
  }
}

/**
 * Evaluates the workflows of one (domain, service) against its new items, on at
 * most one cluster worker at a time. Never throws into the event that triggered it.
 */
export async function runAutomation(domain: AutomationDomain, service: string): Promise<AutomationRun[]> {
  const workflows = await listWorkflows(domain)
  if (!workflows.some(workflow => workflow.enabled)) {
    return []
  }

  const result = await withLock(`automation:${domain}:${service}`, LOCK_TTL_MS, () =>
    runService(domain, service, workflows, automationDeps(service)))

  return result ?? []
}

/** The service a workflow runs against: its own, or the first configured one of the domain */
async function serviceForWorkflow(workflow: AutomationWorkflow): Promise<string | undefined> {
  return workflow.service ?? (await listServices(workflow.domain))[0]?.id
}

/** Runs a workflow against recent, picked or free items without applying anything */
export async function previewWorkflow(request: WorkflowPreviewRequest, lockKey: string): Promise<WorkflowPreviewResult> {
  const errors = validateWorkflow(request.graph, request.domain)
  if (errors.length) {
    throw createError({ status: 400, statusText: errors[0]!.message })
  }

  const decideBatch = workflowDecideBatch()
  const hasDecision = request.graph.nodes.some(node => node.type === 'decision')

  const result = await withLock(`automation:preview:${lockKey}`, PREVIEW_LOCK_TTL_MS, async (): Promise<WorkflowPreviewResult> => {
    if (request.source.kind === 'text') {
      if (!decideBatch) {
        return { items: [], aiUnavailable: true }
      }
      try {
        const answers = await runDecisionNodesBatch(request.graph, request.source.text, decideBatch)
        return {
          items: [{ ref: 'text', title: request.source.text.slice(0, 80), path: [], answers, actions: [] }],
          aiUnavailable: false
        }
      } catch (error) {
        // A failed decision must not fail the whole preview
        return {
          items: [{ ref: 'text', title: request.source.text.slice(0, 80), path: [], answers: {}, actions: [], error: errorMessage(error) }],
          aiUnavailable: false
        }
      }
    }

    const service = request.service ?? (await listServices(request.domain))[0]?.id
    if (!service) {
      return { items: [], aiUnavailable: false }
    }

    const limit = Math.min(request.source.kind === 'recent' ? (request.source.limit ?? PREVIEW_MAX_ITEMS) : 1, PREVIEW_MAX_ITEMS)
    const items = request.source.kind === 'item'
      ? [await loadItemByRef(request.source.ref)]
      : await loadRecentItems(request.domain, service, limit)

    // One batched walk for the whole set: decision nodes are grouped by question
    const results = await runWorkflowBatch(request.graph, items, decideBatch ?? emptyPreviewDecide)

    return {
      items: results.map((run, index) => ({
        ref: itemRef(items[index]!),
        title: items[index]!.title,
        path: run.path,
        answers: run.answers,
        actions: run.actions,
        error: run.error
      })),
      aiUnavailable: hasDecision && !decideBatch
    }
  })

  if (result === undefined) {
    throw createError({ status: 409, statusText: 'A preview is already running' })
  }

  return result
}

/** Used when no engine is configured: decisions fall through to `other`/`unsure` */
const emptyPreviewDecide: WorkflowDecideBatch = async () => []

/** Applies a recorded suggestion */
export async function applySuggestion(id: string): Promise<AutomationRun> {
  const run = await getRun(id)
  if (run.outcome !== 'suggested') {
    throw createError({ status: 409, statusText: 'Only a suggestion can be applied' })
  }

  const applier = await applierFor(run.domain, run.service)
  const { applied } = await applyRunActions(run, applier)
  return await updateRun(id, { outcome: 'applied', applied, error: null, feedback: 'accepted' })
}

/** Reverses an applied run from the actions it recorded */
export async function undoAutomationRun(id: string): Promise<AutomationRun> {
  const run = await getRun(id)
  if (run.outcome !== 'applied') {
    throw createError({ status: 409, statusText: 'Only an applied run can be undone' })
  }

  const applier = await applierFor(run.domain, run.service)
  await applier.undo(undoPlan(run))
  return await updateRun(id, { outcome: 'undone', feedback: 'rejected' })
}

/** Marks a suggestion as rejected; it stays as a labelled example for fine-tuning */
export async function rejectSuggestion(id: string): Promise<AutomationRun> {
  const run = await getRun(id)
  if (run.outcome !== 'suggested') {
    throw createError({ status: 409, statusText: 'Only a suggestion can be rejected' })
  }
  return await updateRun(id, { outcome: 'skipped', feedback: 'rejected' })
}

/**
 * The scheduler's safety net: documents and inbox mail whose domain event was
 * missed are loaded since a per-service cursor and fed to the same evaluation.
 * Runs every few minutes; each (domain, service) is swept by one worker at a time.
 */
export async function sweepAutomation(): Promise<Record<AutomationDomain, number>> {
  const deps: SweepDeps = {
    services: async domain => (await listServices(domain)).map(service => service.id),
    cursor: readSweepCursor,
    setCursor: writeSweepCursor,
    load: (domain, service, since, limit) => domain === 'mail'
      ? loadMailSince(service, since, limit)
      : loadDocumentsSince(service, since, limit),
    evaluate: async (domain, service, items) => {
      const workflows = await listWorkflows(domain)
      if (!workflows.some(workflow => workflow.enabled)) {
        return []
      }
      return await evaluateCandidates(domain, service, items, workflows, automationDeps(service))
    },
    withLock,
    logger: automationLogger('sweep')
  }

  return await sweepAll(deps)
}

export { serviceForWorkflow }
