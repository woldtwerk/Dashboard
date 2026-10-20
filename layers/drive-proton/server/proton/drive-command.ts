import type { DriveEntry, DriveInvitation, DriveShare, DriveShareOptions } from '../../../drive/shared/types/drive'
import { joinPath, parentPath } from '../../../drive/shared/drive-path'

/** Result of one `proton-drive` invocation, as the container reports it. */
export interface DriveCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** The fields `--json` returns for one entry; pseudo sections have no `type`. */
interface CliEntry {
  uid?: string | number
  type?: string
  name?: string | { ok?: boolean, value?: string }
  mediaType?: string
  modificationTime?: string
  activeRevision?: { claimedSize?: number }
  claimedSize?: number
}

interface CliJson extends Record<string, unknown> {
  entries?: unknown
  invitations?: unknown
}

// --- argv building --------------------------------------------------------

export function buildListArgs(path: string): string[] {
  return ['filesystem', 'list', path]
}

export function buildInfoArgs(path: string): string[] {
  return ['filesystem', 'info', path]
}

export function buildSizeArgs(path: string): string[] {
  return ['filesystem', 'size', path]
}

export function buildCreateFolderArgs(parentPath: string, name: string): string[] {
  return ['filesystem', 'create-folder', parentPath, name]
}

export function buildRenameArgs(path: string, name: string): string[] {
  return ['filesystem', 'rename', path, name]
}

/**
 * Whether a failure line is the CLI looking a renamed node up by its old name.
 * It renames first and reports `Node not found: <old name>` afterwards, so the
 * rename has already gone through. The name is compared literally: it may
 * contain `(`, `.` and spaces.
 */
export function isRenameLookupMiss(stderrLine: string, oldName: string): boolean {
  return stderrLine.trim() === `Node not found: ${oldName}`
}

export function buildMoveArgs(paths: string[], target: string): string[] {
  return ['filesystem', 'move', ...paths, target]
}

export function buildCopyArgs(paths: string[], target: string, name?: string): string[] {
  const flags = name ? ['-n', name] : []
  return ['filesystem', 'copy', ...flags, ...paths, target]
}

export function buildTrashArgs(paths: string[]): string[] {
  return ['filesystem', 'trash', ...paths]
}

export function buildRestoreArgs(paths: string[]): string[] {
  return ['filesystem', 'restore', ...paths]
}

export function buildDeleteArgs(paths: string[]): string[] {
  return ['filesystem', 'delete', ...paths]
}

export function buildEmptyTrashArgs(): string[] {
  return ['filesystem', 'empty-trash']
}

export function buildShareStatusArgs(path: string): string[] {
  return ['sharing', 'status', path]
}

export function buildSetShareArgs(path: string, options: DriveShareOptions): string[] {
  const flags: string[] = []
  if (options.role) {
    flags.push('--role', options.role)
  }
  if (options.password) {
    flags.push('--password', options.password)
  }
  if (options.expiration) {
    flags.push('--expiration', options.expiration)
  }
  return ['sharing', 'set-url', ...flags, path]
}

export function buildRemoveShareArgs(path: string): string[] {
  return ['sharing', 'remove-url', path]
}

export function buildInvitationListArgs(): string[] {
  return ['invitation', 'list']
}

export function buildInvitationArgs(uid: string, accept: boolean): string[] {
  return ['invitation', accept ? 'accept' : 'reject', uid]
}

// --- JSON → domain mapping ------------------------------------------------

/** Parses the JSON the CLI prints, tolerating progress lines before it. */
export function parseJson(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return undefined
  }

  const candidates = [trimmed.indexOf('{'), trimmed.indexOf('[')].filter(index => index >= 0)
  if (!candidates.length) {
    return undefined
  }

  try {
    return JSON.parse(trimmed.slice(Math.min(...candidates)))
  } catch {
    return undefined
  }
}

function entryName(entry: CliEntry): string {
  if (typeof entry.name === 'string') {
    return entry.name
  }
  return entry.name?.value ?? ''
}

function entrySize(entry: CliEntry): number | undefined {
  const size = entry.activeRevision?.claimedSize ?? entry.claimedSize
  return typeof size === 'number' ? size : undefined
}

function isEntry(value: unknown): value is CliEntry {
  const entry = value as CliEntry | undefined
  return !!entry && (entry.type === 'folder' || entry.type === 'file')
}

function toEntry(entry: CliEntry, parent: string): DriveEntry {
  const name = entryName(entry)
  const path = joinPath(parent, name)

  return {
    uid: entry.uid !== undefined ? String(entry.uid) : path,
    name,
    type: entry.type === 'folder' ? 'folder' : 'file',
    parent,
    path,
    size: entrySize(entry),
    modified: entry.modificationTime ? String(entry.modificationTime) : undefined,
    mediaType: entry.mediaType ? String(entry.mediaType) : undefined
  }
}

function toList(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) {
    return value
  }
  const nested = (value as CliJson | undefined)?.[key]
  return Array.isArray(nested) ? nested : []
}

/** Entries of a folder listing; pseudo sections without a `type` are left out. */
export function parseEntries(stdout: string, parent: string): DriveEntry[] {
  return toList(parseJson(stdout), 'entries').filter(isEntry).map(entry => toEntry(entry, parent))
}

/** A single entry from `filesystem info`. */
export function parseEntry(stdout: string, path: string): DriveEntry | undefined {
  const data = parseJson(stdout)
  const candidate = Array.isArray(data) ? data.find(isEntry) : data
  const entry = candidate && typeof candidate === 'object' && 'entry' in candidate
    ? (candidate as { entry: unknown }).entry
    : candidate

  return isEntry(entry) ? toEntry(entry, parentPath(path)) : undefined
}

/** A byte count from JSON, accepting numbers and numeric strings */
function bytesOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
  }
  return undefined
}

/**
 * The size `filesystem size --json` reports. The CLI prints
 * `{ size, numberOfDescendants }`; older or wrapped shapes name the size
 * differently, so every plausible field is accepted.
 */
export function parseUsedBytes(stdout: string): number | undefined {
  const data = parseJson(stdout)

  function fromObject(value: unknown): number | undefined {
    if (Array.isArray(value)) {
      return value.map(fromObject).find((size): size is number => size !== undefined)
    }
    if (!value || typeof value !== 'object') {
      return undefined
    }

    const record = value as Record<string, unknown>
    for (const key of ['size', 'totalSize', 'totalSizeBytes', 'usedBytes', 'storageSize', 'bytes']) {
      const size = bytesOf(record[key])
      if (size !== undefined) {
        return size
      }
    }
    for (const key of ['folderSize', 'result', 'data']) {
      const size = fromObject(record[key])
      if (size !== undefined) {
        return size
      }
    }
    return undefined
  }

  return bytesOf(data) ?? fromObject(data)
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/** The public link status of a path; the CLI's exact fields vary by version. */
export function parseShare(stdout: string): DriveShare {
  const data = parseJson(stdout)
  const item = (data && typeof data === 'object' ? ('share' in data ? (data as { share: unknown }).share : data) : {}) as Record<string, unknown>

  const url = stringOf(item.url) ?? stringOf(item.publicUrl) ?? stringOf(item.shareUrl) ?? stringOf(item.link)
  const role = stringOf(item.role)

  return {
    shared: Boolean(item.shared ?? url ?? item.shareId ?? item.linkId),
    url,
    role,
    passwordProtected: Boolean(item.password ?? item.passwordProtected ?? item.hasPassword),
    expiration: stringOf(item.expiration) ?? stringOf(item.expireTime)
  }
}

/** Invitations to folders others shared with the account. */
export function parseInvitations(stdout: string): DriveInvitation[] {
  return toList(parseJson(stdout), 'invitations')
    .map((value): DriveInvitation | undefined => {
      const item = value as Record<string, unknown>
      const uid = item.uid ?? item.invitationUid ?? item.id
      if (uid === undefined || uid === null) {
        return undefined
      }
      return {
        uid: String(uid),
        name: entryName(item as CliEntry) || stringOf(item.name) || 'Shared folder',
        from: stringOf(item.sharerEmail) ?? stringOf(item.from) ?? stringOf(item.sharer)
      }
    })
    .filter((invitation): invitation is DriveInvitation => !!invitation)
}
