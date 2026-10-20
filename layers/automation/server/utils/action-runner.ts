import type {
  AppliedAction,
  AutomationItem,
  ExtractAction,
  NotifyAction,
  PlannedAction,
  SaveToDriveAction
} from '../../shared/types/automation'
import type { FileSourceMeta } from '../../../core/shared/types/file-sources'
import { normalizeDriveFolderInput } from '../../../drive/shared/drive-path'
import { saveFilesToDrive } from '../../../drive/server/utils/drive-save'
import type { DriveFileHistory, DriveSavePort } from '../../../drive/server/utils/drive-save'
import { resolveMimeType } from '../../../core/shared/mime'
import {
  extractLoginCode,
  extractWithRegex,
  renderTemplate
} from '../../shared/extractors'
import { matchesMimeGlob } from '../../shared/mime'
import type { AutomationApplier } from './engine'

/** What the runner needs besides the actions and the item */
export interface ActionRunContext {
  /** The workflow's name, available to templates as `{{workflow}}` */
  workflow?: string
  /** The clock a modal's expiry is based on; defaults to the real one */
  now?: () => Date
  /** The item's attachments with their bytes; a domain without any returns an empty list */
  itemFiles?: (item: AutomationItem) => Promise<Array<FileSourceMeta & { content: Uint8Array }>>
  /** The drive a save-to-drive action writes to */
  drive?: DriveSavePort
  /** The content record of already saved files, so each body is saved once */
  driveHistory?: DriveFileHistory
  /** Renews a long run's lease before each upload; a lost lease stops the save */
  onBeforeUpload?: () => Promise<void> | void
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
 * Saves the item's attachments the action accepts into its drive folder. With the
 * duplicate check on (the default) a file whose bytes were already saved into the
 * folder is skipped, whatever its name, so the same video arriving in several mails
 * is stored once, and a file already there by name and size is skipped too — that
 * catches files put there by hand. With it off, both skips are gone: the same bytes
 * are stored again and a same-name file is renamed or skipped as the action asks.
 * The content record is written either way, so turning the check back on later
 * knows the file. No matching file is not an error: the run still records that
 * nothing matched, so the activity list can tell it from a save that skipped
 * every file.
 */
async function saveToDrive(
  action: SaveToDriveAction,
  item: AutomationItem,
  context: ActionRunContext
): Promise<Extract<AppliedAction, { type: 'save-to-drive' }>> {
  if (!context.itemFiles) {
    throw new Error('Saving attachments is not available for this item')
  }

  const files = (await context.itemFiles(item))
    .map((file) => {
      const contentType = resolveMimeType(file.contentType, file.filename)
      return { ...file, contentType }
    })
    .filter(file => matchesMimeGlob(file.contentType, action.accept, file.filename))
  if (!files.length) {
    return { type: 'save-to-drive', service: action.service, paths: [], skipped: [], matched: 0 }
  }

  if (!context.drive) {
    throw new Error('Saving attachments to a drive is not available')
  }
  if (!context.driveHistory) {
    throw new Error('Tracking saved attachments is not available')
  }
  // A stored graph may hold a hand-written folder, e.g. `Public/salsa`
  const folder = normalizeDriveFolderInput(action.folder) ?? action.folder

  const result = await saveFilesToDrive(action.service, folder, files, {
    conflict: action.conflict ?? 'rename',
    checkDuplicates: action.checkDuplicates !== false,
    onBeforeUpload: context.onBeforeUpload
  }, {
    drive: context.drive,
    history: context.driveHistory
  })

  return {
    type: 'save-to-drive',
    service: action.service,
    paths: result.saved,
    skipped: result.skipped,
    matched: files.length
  }
}

/**
 * Runs a workflow's actions in order. Generic actions (`extract`, `notify`,
 * `save-to-drive`) are handled here; every domain action is handed to the domain
 * applier one at a time, carrying the item it returns forward, so a mail's new
 * uid after a move reaches the next action. An `extract` that finds nothing
 * throws, which stops the run before the following actions — a trash after a
 * failed extract never happens. A save-to-drive that fails likewise stops the
 * chain, so a following trash only runs once the files are on the drive.
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

    if (action.type === 'save-to-drive') {
      applied.push(await saveToDrive(action, current, context))
      continue
    }

    const result = await applier.apply([action], current)
    applied.push(...result.applied)
    current = result.item
  }

  return { applied, item: current, variables }
}
