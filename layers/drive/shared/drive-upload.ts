import { extensionForMimeType, fileExtension } from '../../core/shared/mime'
import { splitPath, unescapeSegment } from './drive-path'

/** The longest file name most filesystems accept, in UTF-8 bytes */
export const DRIVE_FILE_NAME_MAX_BYTES = 255

const encoder = new TextEncoder()

function byteLength(value: string): number {
  return encoder.encode(value).byteLength
}

/** Cuts a string to at most `maxBytes` UTF-8 bytes without splitting a character */
function truncateToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return ''
  }
  if (byteLength(value) <= maxBytes) {
    return value
  }

  let result = ''
  let used = 0
  for (const character of value) {
    const bytes = byteLength(character)
    if (used + bytes > maxBytes) {
      break
    }
    result += character
    used += bytes
  }
  return result
}

/** The SHA-256 of a file's bytes as lower-case hex, the content key of the drive table */
export async function sha256Hex(content: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(content))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** A name for an attachment that lost its own: `attachment-<n>.<ext>` */
export function attachmentFallbackName(filename: string | undefined, contentType: string | undefined, index: number): string {
  const extension = fileExtension(filename ?? '') ?? extensionForMimeType(contentType) ?? 'bin'
  return `attachment-${index + 1}.${extension}`
}

/**
 * Makes an attachment's name a safe single path segment. Mail is untrusted, so
 * separators (a name must not escape its folder), control characters and NUL are
 * removed, a name of only dots is dropped, leading dots go (no hidden files) and
 * the result is capped at 255 UTF-8 bytes with its extension kept. Nothing left
 * becomes `attachment-<n>.<ext>`.
 */
export function sanitizeDriveFileName(filename: string | undefined, contentType: string | undefined, index: number): string {
  const original = filename ?? ''
  const cleaned = original
    .replace(/\p{Cc}/gu, '')
    .replace(/[\\/]/g, '')
    .trim()

  const name = /^\.+$/.test(cleaned) ? '' : cleaned.replace(/^\.+/, '').trim()
  if (!name) {
    return attachmentFallbackName(original, contentType, index)
  }

  if (byteLength(name) <= DRIVE_FILE_NAME_MAX_BYTES) {
    return name
  }

  const dot = name.lastIndexOf('.')
  const extension = dot > 0 && dot < name.length - 1 ? name.slice(dot) : ''
  const extensionBytes = byteLength(extension)
  if (extensionBytes >= DRIVE_FILE_NAME_MAX_BYTES) {
    return truncateToBytes(extension, DRIVE_FILE_NAME_MAX_BYTES)
  }

  const stem = truncateToBytes(name.slice(0, name.length - extension.length), DRIVE_FILE_NAME_MAX_BYTES - extensionBytes).trimEnd()
  return stem ? `${stem}${extension}` : attachmentFallbackName(original, contentType, index)
}

/** What to do when the target folder already holds a file of the same name */
export type DriveNameConflict = 'rename' | 'skip'

/** A file already in the folder, as the conflict check sees it */
export interface ExistingDriveFile {
  name: string
  size: number
}

/** Splits a name into its stem and extension, keeping a leading dot in the stem */
function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}

/** `report.pdf` → `report (2).pdf`; the extension stays last */
export function suffixedDriveName(name: string, index: number): string {
  const [stem, extension] = splitExtension(name)
  return `${stem} (${index})${extension}`
}

/**
 * The name to upload a file under, or `null` to skip it.
 *
 * A file with the same name and the same size is already there, so it is skipped
 * whatever the conflict rule: a rerun, a retry or a second worker cannot upload
 * it twice. A same-name file of another size is renamed (`name (1).ext`, then
 * `name (2).ext`, …) or skipped, as the action asks.
 */
export function uniqueDriveName(
  existing: ReadonlyArray<ExistingDriveFile>,
  name: string,
  size: number,
  conflict: DriveNameConflict = 'rename'
): string | null {
  const sizes = new Map(existing.map(file => [file.name, file.size]))
  let candidate = name

  for (let index = 1; sizes.has(candidate); index++) {
    if (sizes.get(candidate) === size) {
      return null
    }
    if (conflict === 'skip') {
      return null
    }
    candidate = suffixedDriveName(name, index)
  }

  return candidate
}

/** One `mkdir -p` step: list `parent`, then create `name` there when it is missing */
export interface DriveFolderStep {
  parent: string
  name: string
  path: string
}

/**
 * The folders below a section root that a path needs, outermost first. The
 * section root itself (`/my-files`) is not created: it exists by definition.
 */
export function folderSteps(path: string): DriveFolderStep[] {
  const segments = splitPath(path)
  if (segments.length < 2) {
    return []
  }

  const steps: DriveFolderStep[] = []
  for (let index = 1; index < segments.length; index++) {
    steps.push({
      parent: `/${segments.slice(0, index).join('/')}`,
      name: unescapeSegment(segments[index]!),
      path: `/${segments.slice(0, index + 1).join('/')}`
    })
  }
  return steps
}
