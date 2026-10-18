/**
 * Paths in the drive are slash-separated, and a slash inside a file or folder
 * name is escaped as `\/` — the same convention the Proton Drive CLI uses. These
 * functions are the single place that knows the convention, so the server, the
 * provider and the explorer agree on it.
 */

export const DRIVE_ROOT = '/'

/** The trash section's root folder; trashing, restoring and purging all change its listing. */
export const DRIVE_TRASH_ROOT = '/trash'

/** Escapes a name for use as one path segment. */
export function escapeSegment(name: string): string {
  return name.replace(/\//g, '\\/')
}

/** Turns one escaped path segment back into a name. */
export function unescapeSegment(segment: string): string {
  return segment.replace(/\\\//g, '/')
}

/** Splits a path into segments, ignoring the empty ones and honoring `\/`. */
export function splitPath(path: string): string[] {
  const segments: string[] = []
  let current = ''

  for (let index = 0; index < path.length; index++) {
    const char = path[index]

    if (char === '\\' && path[index + 1] === '/') {
      current += '\\/'
      index++
      continue
    }
    if (char === '/') {
      if (current) {
        segments.push(current)
        current = ''
      }
      continue
    }
    current += char
  }

  if (current) {
    segments.push(current)
  }

  return segments
}

/** Guarantees a leading slash and no trailing one (except the root itself). */
export function normalizePath(path: string): string {
  const segments = splitPath(path)
  return segments.length ? `/${segments.join('/')}` : DRIVE_ROOT
}

/** Appends a name to a parent path, escaping the name's slashes. */
export function joinPath(parent: string, name: string): string {
  const base = normalizePath(parent)
  const segment = escapeSegment(name)
  return base === DRIVE_ROOT ? `/${segment}` : `${base}/${segment}`
}

/** The path of the folder that holds `path`. */
export function parentPath(path: string): string {
  const segments = splitPath(path)
  segments.pop()
  return segments.length ? `/${segments.join('/')}` : DRIVE_ROOT
}

/** The name of the entry at `path`. */
export function baseName(path: string): string {
  const segments = splitPath(path)
  return segments.length ? unescapeSegment(segments.at(-1)!) : ''
}

export interface DriveBreadcrumb {
  name: string
  path: string
}

/** The chain from the root to `path`, each with its own path; the root is not included. */
export function breadcrumbs(path: string): DriveBreadcrumb[] {
  const segments = splitPath(path)

  return segments.map((segment, index) => ({
    name: unescapeSegment(segment),
    path: `/${segments.slice(0, index + 1).join('/')}`
  }))
}

/** Whether `path` is `root` itself or lies below it. */
export function isWithinPath(root: string, path: string): boolean {
  const normalized = normalizePath(path)
  const target = normalizePath(root)
  return normalized === target || normalized.startsWith(`${target}/`)
}
