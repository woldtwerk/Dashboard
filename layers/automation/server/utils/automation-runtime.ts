import { createError } from 'nuxt/server'
import type {
  AutomationDomain,
  AutomationItem,
  AutomationRun,
  AutomationWorkflow,
  WorkflowPreviewEvent,
  WorkflowPreviewItem,
  WorkflowPreviewRequest,
  WorkflowPreviewResult,
  WorkflowRunItemResult,
  WorkflowRunResult
} from '../../shared/types/automation'
import { FallbackUnavailableError, runDecisionNodesBatch, runWorkflowBatch, validateWorkflow } from '../../shared/workflow'
import { undoBatches } from '../../shared/automation'
import { modalRef } from '../../shared/extractors'
import type { WorkflowBatchResult, WorkflowDecide, WorkflowDecideBatch, WorkflowFallbackDecideBatch } from '../../shared/workflow'
import { entityKey, parseEntityKey } from '../../../core/shared/entities'
import { createDocumentsApplier, createMailApplier, toMailActionProvider } from './appliers'
import { publishModalEvent, publishReviewEvent, publishReviewNeeded } from './automation-events'
import type { AutomationApplier, AutomationDeps, AutomationLogger } from './engine'
import { announceRunNotifications, answerReview, applyRunActions, errorMessage, evaluateCandidates, runService, runWorkflowOnItems, undoPlan } from './engine'
import { MANUAL_RUN_LOCK_TTL_MS, runManualGroups } from './manual-run'
import type { ManualRunEntry } from './manual-run'
import { sweepAll } from './automation-sweep'
import type { SweepDeps } from './automation-sweep'
import { fallbackEngine, hasDecisionEngine, useDecisionEngine } from './decision-engine'
import { itemRef, loadDocumentsSince, loadItemByRef, loadItems, loadMailSince, loadRecentItems } from './automation-items'
import { getWorkflow, listWorkflows } from './workflows'
import { dueItems, getRun, markEvaluated, readSweepCursor, recordAttempt, recordRun, updateRun, writeSweepCursor } from './runs'
import { forgetSavedFiles, hasSavedFile, recordSavedFile } from '../../../drive/server/utils/drive-files'
import { createDriveSavePort } from '../../../drive/server/utils/drive-save'
import type { DriveFileHistory } from '../../../drive/server/utils/drive-save'
import type { ActionRunContext } from './action-runner'
import type { FileSourceMeta } from '../../../core/shared/types/file-sources'
import { getFileSource, readFileSource } from '../../../core/server/utils/file-sources'
import { affectedPaths, invalidateDriveListings } from '../../../drive/server/utils/drive-cache'
import { publishDriveChanges, publishDriveTrashChange } from '../../../drive/server/utils/drive-events'
import {
  cancelPaymentRequest,
  createPaymentRequests,
  getPaymentRequest,
  markPaid as markPaymentPaid,
  markUnpaid,
  openRequestsForMatching,
  requestForPaymentSource
} from '../../../payments/server/utils/payment-requests'
import { sendPaymentRequest } from '../../../payments/server/utils/payment-send'
import { usePayee } from '../../../payments/server/utils/payee'
import { verifySenderDkim } from '../../../mail/server/utils/mail-dkim'
import { htmlBodyFromRaw } from '../../../mail/server/utils/mail-source'

const LOCK_TTL_MS = 5 * 60_000
// A preview with AI fallbacks asks a language model once per unsure item, so a
// 50-item run can easily outlive a short lease. The lease is released as soon as
// the preview finishes; the long TTL only covers a worker that crashes mid-run.
const PREVIEW_LOCK_TTL_MS = 5 * 60_000
const REVIEW_LOCK_TTL_MS = 60_000
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

/**
 * The AI fallbacks a decision node can hand an unsure item to. Absent when no layer
 * registered one; a fallback that cannot answer throws `FallbackUnavailableError`,
 * which the walk records as an attempt and skips.
 */
function workflowFallbackDecideBatch(): WorkflowFallbackDecideBatch | undefined {
  if (!fallbackEngine('ai')) {
    return undefined
  }
  return async (fallback, states, questions) => {
    const create = fallbackEngine('ai')
    if (!create) {
      throw new FallbackUnavailableError()
    }
    return await create(fallback).decideBatch(states, questions)
  }
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

/** The item's attachments; only mail has them, every other domain has none yet */
async function itemFiles(item: AutomationItem): Promise<Array<FileSourceMeta & { content: Uint8Array }>> {
  if (item.domain !== 'mail' || !item.mailbox || item.uid === undefined) {
    return []
  }

  // The mail-specific ref is only a string here; the mail layer's file source
  // knows how to read it, so this file never imports a mail provider for it.
  const source = getFileSource('mail')
  if (!source?.list) {
    return []
  }

  const ref = entityKey({ type: 'mail', service: item.service, id: `${item.mailbox}/${item.uid}` })
  const attachments = (await source.list(ref)).filter(attachment => !attachment.inline && !!attachment.part)

  const files: Array<FileSourceMeta & { content: Uint8Array }> = []
  for (const attachment of attachments) {
    const opened = await source.open(ref, attachment.part!)
    if (!opened) {
      continue
    }
    try {
      files.push({ ...opened.meta, content: await readFileSource(opened.stream) })
    } finally {
      await opened.close()
    }
  }
  return files
}

/** The notification a payment action leaves when it cannot confirm a mail */
async function announcePaymentReview(input: { service: string, itemKey: string, title: string, body: string }): Promise<void> {
  // The event refreshes the automation badge even if the notification fails
  try {
    await publishReviewNeeded(input.service)
  } catch {
    // Best-effort, like every other announcement
  }

  await notify({
    category: 'automation',
    title: input.title,
    body: input.body,
    to: '/payments',
    domain: 'automation',
    service: input.service,
    dedupeKey: `automation:payment-review:${input.service}:${input.itemKey}`
  })
}

/** The ports generic actions need, built for one run */
function actionContextFor(keepAlive?: () => Promise<boolean>): ActionRunContext {
  return {
    itemFiles,
    drive: createDriveSavePort(),
    driveHistory: driveFileHistory(),
    // A lost lease stops the run before the next upload; the idempotent skip
    // keeps a takeover harmless.
    onBeforeUpload: keepAlive
      ? async () => {
        if (!(await keepAlive())) {
          throw new Error('The automation lock was lost while saving to the drive')
        }
      }
      : undefined,
    payments: {
      async createRequests(service, input, options) {
        const rows = await createPaymentRequests(service, input, options)
        return rows.map(row => ({ id: row.id, reference: row.reference, amountCents: row.amountCents }))
      },
      async sendRequest(id) {
        await sendPaymentRequest(id)
      },
      openRequests: service => openRequestsForMatching(service),
      async payeePaypalEmails(service) {
        return (await usePayee(service)).paypalEmails ?? []
      },
      markPaid: (id, input) => markPaymentPaid(id, input),
      async getRequest(id) {
        const request = await getPaymentRequest(id)
        return request ? { status: request.status, paidCents: request.paidCents } : undefined
      },
      async paidRequestForSource(service, source) {
        const request = await requestForPaymentSource(service, source)
        return request ? { requestId: request.id, reference: request.reference } : undefined
      }
    },
    verifyMailSender: async (service, mailbox, uid, check) => {
      const provider = await useMailProvider(service)
      const raw = await provider.getRawMessage(mailbox, uid)
      if (!raw) {
        return { ok: false, reason: 'the mail source is not available' }
      }

      const verdict = await verifySenderDkim(raw, check)
      // The fetch that proved the signature carries the body the parser needs,
      // so a verified mail costs one connection
      return verdict.ok ? { ...verdict, html: await htmlBodyFromRaw(raw) } : verdict
    },
    announcePaymentReview
  }
}

/**
 * The content records of saved files. A row that loses the insert race means a
 * second worker uploaded the same bytes in parallel; the extra upload stays and
 * is logged, because both were already past the check when they started.
 */
function driveFileHistory(): DriveFileHistory {
  return {
    has: (service, folder, sha256) => hasSavedFile(service, folder, sha256),
    async record(file) {
      const recorded = await recordSavedFile(file)
      if (!recorded) {
        automationLogger(file.service).warn?.('Another worker saved the same file; the duplicate upload is kept', {
          path: file.path,
          sha256: file.sha256
        })
      }
      return recorded
    }
  }
}

/** One suggestion becomes one in-app notification, deduplicated by run */
async function notifySuggestion(run: AutomationRun): Promise<void> {
  if (run.outcome === 'review') {
    // A review pauses the run; the resume may suggest its actions later, so the two
    // notifications get separate dedupe keys
    await notify({
      category: 'automation',
      title: `${run.workflowName} needs your decision`,
      body: run.item.title,
      to: '/automation/activity',
      domain: 'automation',
      service: run.service,
      dedupeKey: `automation:review:${run.id}`
    })
    return
  }

  const actions = run.actions.map(planned => planned.action.type).join(', ')

  await notify({
    category: 'automation',
    title: `Suggestion: ${run.workflowName}`,
    body: actions ? `${run.item.title} — ${actions}` : run.item.title,
    to: '/automation/activity',
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
    to: '/automation/activity',
    domain: 'automation',
    service,
    dedupeKey: `automation-failed:${domain}:${service}:${item.key}`
  })
}

/**
 * Sends the notifications an applied run produced. A notification with a modal
 * opens `/automation` with the modal in the URL and publishes a domain event, so
 * every open tab pops it; without a modal it only points at the activity list.
 * Best-effort, like `notify`: a failure is logged and never fails the run.
 *
 * The notification's title and body leave the machine through a desktop push, so
 * a workflow must not put a secret in them. The modal text stays on the server;
 * the modal fetches it from the run.
 */
async function announceWorkflowNotifications(run: AutomationRun): Promise<void> {
  for (const action of run.applied) {
    if (action.type !== 'notify') {
      continue
    }

    const ref = action.modal ? modalRef(run.id, action.nodeId) : undefined
    await notify({
      category: 'automation-notify',
      title: action.title,
      body: action.body,
      to: ref ? `/automation/activity?automation-modal=${ref}` : '/automation/activity',
      domain: 'automation',
      service: run.service,
      dedupeKey: `automation:notify:${run.id}:${action.nodeId}`
    })

    // The shared broker fans this out to every worker; open tabs subscribe with
    // `useDomainEvents`. The `modal` type marks it as a notification pop-up, and
    // the resource is the same `<runId>.<nodeId>` the URL carries.
    if (ref) {
      await publishModalEvent(run, action.nodeId)
    }
  }
}

/** The dependencies the runner uses in the running server */
function automationDeps(service: string, keepAlive?: () => Promise<boolean>): AutomationDeps {
  return {
    store: { due: dueItems, markEvaluated, recordAttempt, record: recordRun, update: updateRun, get: getRun },
    decide: workflowDecide(),
    decideBatch: workflowDecideBatch(),
    fallbackDecideBatch: workflowFallbackDecideBatch(),
    loadItems: (domain, id, limit, isDue) => loadItems(domain, id, limit, isDue),
    applierFor,
    actionContext: () => actionContextFor(keepAlive),
    notify: notifySuggestion,
    notifyFailed,
    announceNotifications: announceWorkflowNotifications,
    onReviewChange: publishReviewEvent,
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

  const result = await withLock(`automation:${domain}:${service}`, LOCK_TTL_MS, handle =>
    runService(domain, service, workflows, automationDeps(service, handle.renew)))

  return result ?? []
}

/** The service a workflow runs against: its own, or the first configured one of the domain */
async function serviceForWorkflow(workflow: AutomationWorkflow): Promise<string | undefined> {
  return workflow.service ?? (await listServices(workflow.domain))[0]?.id
}

/**
 * The wire type of a workflow's domain. A ref addresses a mail or a document, and
 * only the matching one can be loaded for this workflow.
 */
function refTypeFor(domain: AutomationDomain): 'mail' | 'document' {
  return domain === 'mail' ? 'mail' : 'document'
}

/** Rejects a ref whose domain or service does not belong to the workflow */
function assertRefForWorkflow(workflow: AutomationWorkflow, ref: string) {
  const parsed = parseEntityKey(ref)
  if (!parsed) {
    throw createError({ status: 400, statusText: 'Invalid item reference' })
  }
  if (parsed.type !== refTypeFor(workflow.domain)) {
    throw createError({ status: 400, statusText: `This workflow only runs on ${workflow.domain}` })
  }
  if (workflow.service && parsed.service !== workflow.service) {
    throw createError({ status: 400, statusText: 'The item belongs to another service' })
  }
}

/**
 * Runs one workflow on items the user picked, e.g. from the mail list's "Run
 * workflow" menu. One run per workflow at a time across the cluster; refs of
 * another domain or service are refused, and an item that is gone becomes a
 * per-item failure so the rest of the batch still runs.
 */
export async function runWorkflowManually(id: string, refs: string[]): Promise<WorkflowRunResult> {
  const workflow = await getWorkflow(id)
  const unique = [...new Set(refs)]
  for (const ref of unique) {
    assertRefForWorkflow(workflow, ref)
  }

  const result = await withLock(`automation:manual:${workflow.id}`, MANUAL_RUN_LOCK_TTL_MS, async (handle): Promise<WorkflowRunResult> => {
    const loaded: ManualRunEntry[] = []
    const byRef = new Map<string, WorkflowRunItemResult>()

    for (const ref of unique) {
      try {
        loaded.push({ ref, item: await loadItemByRef(ref) })
      } catch (error) {
        const status = (error as { statusCode?: number, status?: number })?.statusCode
          ?? (error as { statusCode?: number, status?: number })?.status
        byRef.set(ref, {
          ref,
          outcome: 'failed',
          error: status === 404 ? 'not found' : errorMessage(error)
        })
      }
    }

    if (loaded.length) {
      const results = await runManualGroups(loaded, {
        renew: handle.renew,
        runGroup: (group, beforeItem) => runWorkflowOnItems(
          workflow,
          group.entries.map(entry => entry.item),
          automationDeps(group.service),
          { beforeItem }
        )
      })

      for (const entry of results) {
        byRef.set(entry.ref, entry)
      }
    }

    return { results: unique.map(ref => byRef.get(ref)!).filter(Boolean) }
  })

  if (!result) {
    throw createError({ status: 409, statusText: 'This workflow is already running' })
  }

  return result
}

export interface PreviewProgress {
  /** Receives the preview's progress as it happens: items loaded, questions asked, items done */
  onEvent?: (event: WorkflowPreviewEvent) => void
  /** Stops the walk before its next decision call, e.g. when the client went away */
  signal?: AbortSignal
}

/** Runs a workflow against recent, picked or free items without applying anything */
export async function previewWorkflow(request: WorkflowPreviewRequest, lockKey: string, progress: PreviewProgress = {}): Promise<WorkflowPreviewResult> {
  const errors = validateWorkflow(request.graph, request.domain)
  if (errors.length) {
    throw createError({ status: 400, statusText: errors[0]!.message })
  }

  const decideBatch = workflowDecideBatch()
  const hasDecision = request.graph.nodes.some(node => node.type === 'decision')
  const emit = progress.onEvent ?? (() => {})

  const result = await withLock(`automation:preview:${lockKey}`, PREVIEW_LOCK_TTL_MS, async (): Promise<WorkflowPreviewResult> => {
    if (request.source.kind === 'text') {
      if (!decideBatch) {
        return { items: [], aiUnavailable: true }
      }
      const title = request.source.text.slice(0, 80)
      emit({ type: 'started', items: [{ ref: 'text', title }] })
      let item: WorkflowPreviewItem
      try {
        const answers = await runDecisionNodesBatch(request.graph, request.source.text, decideBatch)
        item = { ref: 'text', title, path: [], answers, actions: [] }
      } catch (error) {
        // A failed decision must not fail the whole preview
        item = { ref: 'text', title, path: [], answers: {}, actions: [], error: errorMessage(error) }
      }
      emit({ type: 'item', index: 0, item })
      return { items: [item], aiUnavailable: false }
    }

    const service = request.service ?? (await listServices(request.domain))[0]?.id
    if (!service) {
      return { items: [], aiUnavailable: false }
    }

    emit({ type: 'loading' })
    const limit = Math.min(request.source.kind === 'recent' ? (request.source.limit ?? PREVIEW_MAX_ITEMS) : 1, PREVIEW_MAX_ITEMS)
    const items = request.source.kind === 'item'
      ? [await loadItemByRef(request.source.ref)]
      : await loadRecentItems(request.domain, service, limit)
    emit({ type: 'started', items: items.map(item => ({ ref: itemRef(item), title: item.title })) })

    const toPreviewItem = (run: WorkflowBatchResult, index: number): WorkflowPreviewItem => ({
      ref: itemRef(items[index]!),
      title: items[index]!.title,
      path: run.path,
      answers: run.answers,
      actions: run.actions,
      review: run.review,
      error: run.error
    })

    // One batched walk for the whole set: decision nodes are grouped by question
    const results = await runWorkflowBatch(request.graph, items, decideBatch ?? emptyPreviewDecide, {
      fallback: workflowFallbackDecideBatch(),
      signal: progress.signal,
      onDecide: (nodeId, count) => emit({ type: 'deciding', nodeId, items: count }),
      onItemDone: (index, run) => emit({ type: 'item', index, item: toPreviewItem(run, index) })
    })

    return {
      items: results.map(toPreviewItem),
      aiUnavailable: hasDecision && !decideBatch
    }
  })

  if (result === undefined) {
    throw createError({ status: 409, statusText: 'A preview is already running; stop it or wait for it to finish' })
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
  const { applied } = await applyRunActions(run, applier, actionContextFor())
  const updated = await updateRun(id, { outcome: 'applied', applied, error: null, feedback: 'accepted' })
  await announceRunNotifications(updated, { announceNotifications: announceWorkflowNotifications, logger: automationLogger(updated.service) })
  return updated
}

/** Moves saved files to the drive's trash, dropping the listings they left */
async function trashDrivePaths(service: string, paths: string[]): Promise<void> {
  if (!paths.length) {
    return
  }

  const provider = await useDriveProvider(service)
  await provider.trash(paths)
  await forgetSavedFiles(service, paths)

  await invalidateDriveListings(service, affectedPaths('trash', { paths }))
  await publishDriveChanges(service, paths)
  await publishDriveTrashChange(service)
}

/**
 * Runs the reversal in plan order. A drive-trash step belongs to the runner, not
 * to the domain applier, so the domain operations around it are handed over in
 * order rather than all at once.
 */
async function undoAppliedActions(run: AutomationRun, applier: AutomationApplier): Promise<void> {
  for (const batch of undoBatches(undoPlan(run))) {
    if (batch.kind === 'drive') {
      await trashDrivePaths(batch.service, batch.paths)
      continue
    }
    if (batch.kind === 'payment-cancel') {
      for (const id of batch.requests) {
        const request = await getPaymentRequest(id)
        // A request paid meanwhile stays paid; the cancellation is best-effort
        if (request?.status === 'open') {
          await cancelPaymentRequest(id)
        }
      }
      continue
    }
    if (batch.kind === 'payment-unpay') {
      const request = await getPaymentRequest(batch.requestId)
      // Only the state this run left is reversed: a later payment or a manual
      // change keeps its money
      if (request?.status === 'paid' && request.paidCents === batch.paidCents) {
        await markUnpaid(batch.requestId)
      }
      continue
    }
    await applier.undo(batch.operations)
  }
}

/** Reverses an applied run from the actions it recorded */
export async function undoAutomationRun(id: string): Promise<AutomationRun> {
  const run = await getRun(id)
  if (run.outcome !== 'applied') {
    throw createError({ status: 409, statusText: 'Only an applied run can be undone' })
  }

  const applier = await applierFor(run.domain, run.service)
  await undoAppliedActions(run, applier)
  return await updateRun(id, { outcome: 'undone', feedback: 'rejected' })
}

/** Marks a suggestion as rejected; it stays as a labelled example for fine-tuning */
export async function rejectSuggestion(id: string): Promise<AutomationRun> {
  const run = await getRun(id)
  // A review can be dismissed as well: the user does not want to decide this item
  if (run.outcome !== 'suggested' && run.outcome !== 'review') {
    throw createError({ status: 409, statusText: 'Only a suggestion or a review can be rejected' })
  }
  const wasReview = run.outcome === 'review'
  const updated = await updateRun(id, { outcome: 'skipped', feedback: 'rejected' })
  if (wasReview) {
    await publishReviewEvent(updated)
  }
  return updated
}

/**
 * Answers a paused review. One worker at a time holds the run's lock and re-reads
 * it inside, so a double click or a second worker cannot answer it twice.
 */
export async function answerAutomationReview(id: string, output: string): Promise<AutomationRun> {
  const result = await withLock(`automation:review:${id}`, REVIEW_LOCK_TTL_MS, async () => {
    const run = await getRun(id)
    return await answerReview(id, output, {
      store: { get: getRun, update: updateRun },
      loadWorkflow: async (workflowId) => {
        try {
          return await getWorkflow(workflowId)
        } catch {
          return undefined
        }
      },
      decideBatch: workflowDecideBatch(),
      fallbackDecideBatch: workflowFallbackDecideBatch(),
      applierFor,
      actionContext: () => actionContextFor(),
      notify: notifySuggestion,
      announceNotifications: announceWorkflowNotifications,
      onReviewChange: publishReviewEvent,
      logger: automationLogger(run.service),
      now: () => new Date()
    })
  })

  if (!result) {
    throw createError({ status: 409, statusText: 'This review is already being answered' })
  }

  return result
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
