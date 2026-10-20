import type {
  AppliedAction,
  AutomationItem,
  ExtractAction,
  NotifyAction,
  PlannedAction,
  SaveToDriveAction
} from '../../shared/types/automation'
import type { MailAttachment } from '../../../mail/shared/types/mail'
import { joinPath } from '../../../drive/shared/drive-path'
import { sanitizeDriveFileName, sha256Hex, uniqueDriveName } from '../../../drive/shared/drive-upload'
import type { DriveNameConflict } from '../../../drive/shared/drive-upload'
import { resolveMimeType } from '../../../core/shared/mime'
import {
  extractLoginCode,
  extractWithRegex,
  renderTemplate
} from '../../shared/extractors'
import { matchesMimeGlob } from '../../shared/mime'
import type { AutomationApplier } from './engine'

/** A file the runner hands to the drive sink */
export interface DriveSaveFile {
  name: string
  contentType: string
  content: Uint8Array
}

/** The drive operations a save-to-drive action needs; the runtime builds it from the provider */
export interface DriveSavePort {
  /** Creates every missing folder below the section root (`mkdir -p`) */
  ensureFolder(service: string, path: string): Promise<void>
  /** The entries directly inside a folder, for the conflict check */
  list(service: string, path: string): Promise<Array<{ name: string, type: 'file' | 'folder', size?: number }>>
  /** Uploads one file; the port invalidates the listing and announces the change */
  upload(service: string, folder: string, file: DriveSaveFile): Promise<void>
}

/** The content records of saved files, so the same bytes are saved only once */
export interface DriveFileHistory {
  /** Whether the same bytes were already saved into this folder */
  has(service: string, folder: string, sha256: string): Promise<boolean>
  /** Records an upload; `false` means another worker recorded the same bytes first */
  record(file: { service: string, folder: string, sha256: string, path: string, size: number }): Promise<boolean>
}

/** What the runner needs besides the actions and the item */
export interface ActionRunContext {
  /** The workflow's name, available to templates as `{{workflow}}` */
  workflow?: string
  /** The clock a modal's expiry is based on; defaults to the real one */
  now?: () => Date
  /** The item's attachments with their bytes; a domain without any returns an empty list */
  itemFiles?: (item: AutomationItem) => Promise<Array<MailAttachment & { content: Uint8Array }>>
  /** The drive a save-to-drive action writes to */
  drive?: DriveSavePort
  /** The content record of already saved files, so each body is saved once */
  driveHistory?: DriveFileHistory
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
 * Saves the item's attachments the action accepts into its drive folder. A file
 * whose bytes were already saved into the folder is skipped, whatever its name,
 * so the same video arriving in several mails is stored once. A file already
 * there by name and size is skipped too — that catches files put there by hand.
 * A same-name file of another size is renamed or skipped as the action asks, and
 * no matching file is not an error: there is simply nothing to record.
 */
async function saveToDrive(
  action: SaveToDriveAction,
  item: AutomationItem,
  context: ActionRunContext
): Promise<Extract<AppliedAction, { type: 'save-to-drive' }> | undefined> {
  if (!context.itemFiles) {
    throw new Error('Saving attachments is not available for this item')
  }

  const files = (await context.itemFiles(item))
    .map((file, index) => {
      const contentType = resolveMimeType(file.contentType, file.filename)
      return { ...file, contentType, filename: sanitizeDriveFileName(file.filename, contentType, index) }
    })
    .filter(file => matchesMimeGlob(file.contentType, action.accept, file.filename))
  if (!files.length) {
    return undefined
  }

  if (!context.drive) {
    throw new Error('Saving attachments to a drive is not available')
  }
  if (!context.driveHistory) {
    throw new Error('Tracking saved attachments is not available')
  }
  const drive = context.drive
  const history = context.driveHistory

  await drive.ensureFolder(action.service, action.folder)
  const existing = (await drive.list(action.service, action.folder))
    .filter(entry => entry.type === 'file')
    .map(entry => ({ name: entry.name, size: entry.size ?? 0 }))

  const conflict: DriveNameConflict = action.conflict ?? 'rename'
  const paths: string[] = []

  for (const file of files) {
    const size = file.content.byteLength
    const sha256 = await sha256Hex(file.content)

    // The same bytes under another name are the same file; do not store them twice
    if (await history.has(action.service, action.folder, sha256)) {
      continue
    }

    const name = uniqueDriveName(existing, file.filename, size, conflict)
    if (!name) {
      continue
    }

    await drive.upload(action.service, action.folder, { name, contentType: file.contentType, content: file.content })
    const path = joinPath(action.folder, name)
    paths.push(path)
    // Two attachments of one mail may share a name; the next one must not overwrite this
    existing.push({ name, size })

    // Insert right after each upload: a later failure keeps what already succeeded
    await history.record({ service: action.service, folder: action.folder, sha256, path, size })
  }

  return paths.length ? { type: 'save-to-drive', service: action.service, paths } : undefined
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
      const saved = await saveToDrive(action, current, context)
      if (saved) {
        applied.push(saved)
      }
      continue
    }

    const result = await applier.apply([action], current)
    applied.push(...result.applied)
    current = result.item
  }

  return { applied, item: current, variables }
}
