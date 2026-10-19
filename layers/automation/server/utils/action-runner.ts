import type {
  AppliedAction,
  AutomationItem,
  ExtractAction,
  NotifyAction,
  PlannedAction
} from '../../shared/types/automation'
import {
  extractLoginCode,
  extractWithRegex,
  renderTemplate
} from '../../shared/extractors'
import type { AutomationApplier } from './engine'

/** What the runner needs besides the actions and the item */
export interface ActionRunContext {
  /** The workflow's name, available to templates as `{{workflow}}` */
  workflow?: string
  /** The clock a modal's expiry is based on; defaults to the real one */
  now?: () => Date
}

export interface ActionRunResult {
  /** What was actually done, with the information a reversal needs */
  applied: AppliedAction[]
  /** The item after every action, e.g. a mail with its new uid after a move */
  item: AutomationItem
  /** The variables the run extracted */
  variables: Record<string, string>
}

/**
 * The text an extract action reads. `subject` is the mail subject (documents have
 * none, so it stays empty); `text` is the body the engine also reads.
 */
function sourceText(item: AutomationItem, action: ExtractAction): string {
  if (action.source === 'subject') {
    return item.fields.subject ?? ''
  }
  return item.fields.text || item.state || ''
}

/** The value an extract action reads, or `undefined` when there is none */
export function extractValue(action: ExtractAction, item: AutomationItem): string | undefined {
  const text = sourceText(item, action)
  if (action.extractor === 'login-code') {
    return extractLoginCode(text)
  }
  return action.pattern ? extractWithRegex(action.pattern, text) : undefined
}

/** The values every template may use, resolved from the item and the run */
function templateValues(item: AutomationItem, workflow: string | undefined, variables: Record<string, string>) {
  return {
    title: item.title,
    subject: item.fields.subject ?? '',
    from: item.fields.from ?? '',
    workflow: workflow ?? '',
    ...variables
  }
}

/** The applied record of a notify action, with its modal text already rendered */
function renderNotify(action: NotifyAction, nodeId: string, values: Record<string, string>, now: Date): Extract<AppliedAction, { type: 'notify' }> {
  const modal = action.modal
    ? {
        title: action.modal.title ? renderTemplate(action.modal.title, values) : undefined,
        text: renderTemplate(action.modal.text, values),
        copy: action.modal.copy ?? false,
        expiresAt: action.modal.expiresInMinutes
          ? new Date(now.getTime() + action.modal.expiresInMinutes * 60_000).toISOString()
          : undefined
      }
    : undefined

  return {
    type: 'notify',
    nodeId,
    title: renderTemplate(action.title, values),
    body: action.body !== undefined ? renderTemplate(action.body, values) : undefined,
    modal
  }
}

/**
 * Runs a workflow's actions in order. Generic actions (`extract`, `notify`) are
 * handled here; every domain action is handed to the domain applier one at a time,
 * carrying the item it returns forward, so a mail's new uid after a move reaches
 * the next action. An `extract` that finds nothing throws, which stops the run
 * before the following actions — a trash after a failed extract never happens.
 */
export async function runActions(
  actions: PlannedAction[],
  item: AutomationItem,
  applier: AutomationApplier,
  context: ActionRunContext = {}
): Promise<ActionRunResult> {
  let current = item
  const applied: AppliedAction[] = []
  const variables: Record<string, string> = {}
  const now = context.now?.() ?? new Date()

  for (const planned of actions) {
    const action = planned.action

    if (action.type === 'extract') {
      const value = extractValue(action, current)
      if (value === undefined) {
        throw new Error(`No ${action.variable} found`)
      }
      variables[action.variable] = value
      applied.push({ type: 'extract', variable: action.variable, value })
      continue
    }

    if (action.type === 'notify') {
      applied.push(renderNotify(action, planned.nodeId, templateValues(current, context.workflow, variables), now))
      continue
    }

    const result = await applier.apply([action], current)
    applied.push(...result.applied)
    current = result.item
  }

  return { applied, item: current, variables }
}
