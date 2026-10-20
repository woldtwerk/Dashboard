import { splitPath, unescapeSegment } from './drive-path'

export { attachmentFallbackName, DRIVE_FILE_NAME_MAX_BYTES, sanitizeDriveFileName } from '../../core/shared/file-name'

/** The SHA-256 of a file's bytes as lower-case hex, the content key of the drive table */
export async function sha256Hex(content: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(content))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
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
 * With `checkDuplicates` on (the default), a file with the same name and the same
 * size is already there, so it is skipped whatever the conflict rule: a rerun, a
 * retry or a second worker cannot upload it twice. With it off, that skip does not
 * happen and a same-name file always goes through the conflict rule. A same-name
 * file of another size is renamed (`name (1).ext`, then `name (2).ext`, …) or
 * skipped, as the action asks.
 */
export function uniqueDriveName(
  existing: ReadonlyArray<ExistingDriveFile>,
  name: string,
  size: number,
  conflict: DriveNameConflict = 'rename',
  checkDuplicates = true
): string | null {
  const sizes = new Map(existing.map(file => [file.name, file.size]))
  let candidate = name

  for (let index = 1; sizes.has(candidate); index++) {
    if (checkDuplicates && sizes.get(candidate) === size) {
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
