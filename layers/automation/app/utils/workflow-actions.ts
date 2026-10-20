import type { ItemActionContext } from '#layers/core/app/utils/item-actions'
import type { AutomationOutcome, AutomationWorkflow, WorkflowRunItemResult } from '#layers/automation/shared/types/automation'
import { formatMoney, parseMoney } from '#layers/payments/shared/money'
import { splitAmount } from '#layers/payments/shared/split'

/**
 * The workflows a "Run workflow" menu may offer for the picked items: those of
 * the items' domain, either scoped to one of their services or to every service,
 * in run order. Disabled workflows stay in the menu (labelled) so the user sees
 * why one does nothing.
 */
export function workflowsForContexts(
  workflows: AutomationWorkflow[],
  contexts: ItemActionContext[]
): AutomationWorkflow[] {
  const domain = contexts[0]?.domain
  if (!domain) {
    return []
  }

  const services = new Set(contexts.map(context => context.service))
  return workflows
    .filter(workflow => workflow.domain === domain)
    .filter(workflow => workflow.service === null || services.has(workflow.service))
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
}

/** `Name`, or `Name (disabled)` when running it would only record a skip */
export function workflowActionLabel(workflow: Pick<AutomationWorkflow, 'name' | 'enabled'>): string {
  return workflow.enabled ? workflow.name : `${workflow.name} (disabled)`
}

const SUMMARY_ORDER: AutomationOutcome[] = ['applied', 'suggested', 'review', 'failed', 'skipped', 'undone']

function summaryLabel(outcome: AutomationOutcome, count: number): string {
  if (outcome === 'review') {
    return count === 1 ? 'needs review' : 'need review'
  }
  return outcome
}

/**
 * The one-line result of a manual run, e.g.
 * `2 applied · 1 needs review · 1 failed`. Only outcomes that occurred appear.
 */
export function formatWorkflowRunSummary(results: Pick<WorkflowRunItemResult, 'outcome'>[]): string {
  if (!results.length) {
    return 'Nothing to run'
  }

  const counts = new Map<AutomationOutcome, number>()
  for (const result of results) {
    counts.set(result.outcome, (counts.get(result.outcome) ?? 0) + 1)
  }

  return SUMMARY_ORDER
    .filter(outcome => counts.has(outcome))
    .map(outcome => `${counts.get(outcome)} ${summaryLabel(outcome, counts.get(outcome)!)}`)
    .join(' · ')
}

/** What a live split preview shows, e.g. `Each pays 3,00 € of 17,99 €` */
export interface PaymentSplitPreview {
  totalCents: number
  shareCents: number
  text: string
}

/**
 * The split a request-payment action will produce, from a sample amount. Undefined
 * while the total or the payer/shares pair cannot form one, so the inspector can
 * show a hint instead of a misleading number.
 */
export function paymentSplitPreview(amount: string, shares: number, payers: number): PaymentSplitPreview | undefined {
  const totalCents = parseMoney(amount)
  if (totalCents === undefined || !Number.isInteger(shares) || !Number.isInteger(payers)) {
    return undefined
  }
  if (shares < 1 || payers < 1 || payers > shares) {
    return undefined
  }

  try {
    const [shareCents] = splitAmount(totalCents, shares, payers)
    return {
      totalCents,
      shareCents: shareCents!,
      text: `${formatMoney(shareCents!)} of ${formatMoney(totalCents)}`
    }
  } catch {
    return undefined
  }
}
