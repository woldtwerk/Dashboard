import type { DriveEntry, DriveSection, DriveSectionKey } from '../../shared/types/drive'
import { DRIVE_MY_FILES_ROOT, DRIVE_SHARED_ROOT, DRIVE_TRASH_ROOT, normalizePath } from '../../shared/drive-path'

export { previewKind, thumbnailAllowed, entryVersion, THUMBNAIL_MAX_BYTES, THUMBNAIL_TILE_WIDTH, THUMBNAIL_ICON_WIDTH } from '../../shared/drive-thumbnails'
export type { DrivePreviewKind } from '../../shared/drive-thumbnails'
export { sortEntries } from '../../shared/drive-sort'

/** The three top-level areas of the explorer, in the order their tabs appear. */
export const DRIVE_SECTIONS: DriveSection[] = [
  { key: 'my-files', label: 'My files', icon: 'i-lucide-hard-drive', root: DRIVE_MY_FILES_ROOT },
  { key: 'shared', label: 'Shared with me', icon: 'i-lucide-users', root: DRIVE_SHARED_ROOT, listsInvitations: true },
  { key: 'trash', label: 'Trash', icon: 'i-lucide-trash-2', root: DRIVE_TRASH_ROOT, emptyable: true }
]

/** The section a path belongs to, defaulting to My files. */
export function sectionOf(path: string): DriveSection {
  const normalized = normalizePath(path)
  return DRIVE_SECTIONS.find(section => normalized === section.root || normalized.startsWith(`${section.root}/`))
    ?? DRIVE_SECTIONS[0]!
}

export function sectionByKey(key: string | undefined): DriveSection | undefined {
  return DRIVE_SECTIONS.find(section => section.key === key)
}

export function defaultPath(section: DriveSectionKey, current?: string): string {
  return current && sectionOf(current).key === section ? current : sectionByKey(section)?.root ?? DRIVE_SECTIONS[0]!.root
}

const MIME_ICONS: { match: RegExp, icon: string }[] = [
  { match: /^image\//, icon: 'i-lucide-file-image' },
  { match: /^video\//, icon: 'i-lucide-file-video' },
  { match: /^audio\//, icon: 'i-lucide-file-audio' },
  { match: /pdf/, icon: 'i-lucide-file-text' },
  { match: /(zip|tar|gzip|compressed|rar|7z)/, icon: 'i-lucide-file-archive' },
  { match: /(spreadsheet|excel|csv)/, icon: 'i-lucide-file-spreadsheet' },
  { match: /(presentation|powerpoint)/, icon: 'i-lucide-file-chart-pie' },
  { match: /(javascript|typescript|json|xml|html|css|code|x-sh)/, icon: 'i-lucide-file-code' },
  { match: /^text\//, icon: 'i-lucide-file-text' },
  { match: /(word|document|opendocument\.text|rtf)/, icon: 'i-lucide-file-type' }
]

/** The icon for an entry, by its media type. */
export function entryIcon(entry: Pick<DriveEntry, 'type' | 'mediaType'>): string {
  if (entry.type === 'folder') {
    return 'i-lucide-folder'
  }
  const mime = entry.mediaType ?? ''
  return MIME_ICONS.find(item => item.match.test(mime))?.icon ?? 'i-lucide-file'
}

/** A human label for an entry's kind, e.g. `PNG image` or `Folder`. */
export function entryKindLabel(entry: Pick<DriveEntry, 'type' | 'mediaType' | 'name'>): string {
  if (entry.type === 'folder') {
    return 'Folder'
  }

  const mime = entry.mediaType ?? ''
  if (mime === 'application/pdf') {
    return 'PDF document'
  }
  if (mime.startsWith('image/')) {
    return `${mime.slice('image/'.length).toUpperCase()} image`
  }
  if (mime.startsWith('video/')) {
    return `${mime.slice('video/'.length).toUpperCase()} video`
  }
  if (mime.startsWith('audio/')) {
    return `${mime.slice('audio/'.length).toUpperCase()} audio`
  }
  if (mime.startsWith('text/')) {
    return 'Text file'
  }

  const extension = entry.name.includes('.') ? entry.name.split('.').pop()!.toUpperCase() : undefined
  return extension ? `${extension} file` : 'File'
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** Formats a byte count, e.g. `1.4 MB`; folders have none. */
export function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) {
    return '—'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }

  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit++
  }

  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${SIZE_UNITS[unit]}`
}

/**
 * Formats a timestamp from its own digits, without the viewer's timezone, so the
 * server-rendered and the hydrated markup always agree.
 */
export function formatDate(iso?: string): string {
  if (!iso) {
    return '—'
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso)
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : iso
}

/** Entries whose name contains the query, case-insensitively. */
export function filterEntries(entries: DriveEntry[], query: string): DriveEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return entries
  }
  return entries.filter(entry => entry.name.toLowerCase().includes(needle))
}

/**
 * The name a rename commit should send, or undefined when there is nothing to
 * do. It only applies while the entry is still the one being edited, which
 * makes a second commit after Enter (the input's blur) a no-op.
 */
export function renameCommit(entry: DriveEntry, draft: string, editingPath: string | undefined): string | undefined {
  const name = draft.trim()
  if (editingPath !== entry.path || !name || name === entry.name) {
    return undefined
  }
  return name
}

export type SelectionMode = 'replace' | 'toggle' | 'range'

export interface DriveSelection {
  selected: string[]
  /** The entry a shift-range grows from */
  anchor?: string
}

/**
 * The next selection for a click. Keys are paths, which are unique within a
 * folder, so a rename or a duplicate name can never select the wrong entry.
 */
export function applySelection(state: DriveSelection, visible: string[], target: string, mode: SelectionMode): DriveSelection {
  if (mode === 'replace') {
    return { selected: [target], anchor: target }
  }

  if (mode === 'toggle') {
    const selected = state.selected.includes(target)
      ? state.selected.filter(key => key !== target)
      : [...state.selected, target]
    return { selected, anchor: target }
  }

  // Range: from the anchor (or the target itself) to the clicked entry, in view order
  const start = state.anchor && visible.includes(state.anchor) ? visible.indexOf(state.anchor) : visible.indexOf(target)
  const end = visible.indexOf(target)
  if (start === -1 || end === -1) {
    return { selected: [target], anchor: target }
  }

  const [from, to] = start <= end ? [start, end] : [end, start]
  return { selected: visible.slice(from, to + 1), anchor: state.anchor ?? target }
}

/**
 * The download URL for one or more entries; the server streams a file or a zip.
 * `inline` asks the server to render a safe type in the browser (a preview);
 * `version` lets an inline response be cached and revalidated with an ETag.
 */
export function downloadUrl(service: string, paths: string[], options: { inline?: boolean, version?: string } = {}): string {
  const params = new URLSearchParams({ service })
  for (const path of paths) {
    params.append('path', path)
  }
  if (options.inline) {
    params.set('inline', '1')
  }
  if (options.version) {
    params.set('v', options.version)
  }
  return `/api/drive/download?${params.toString()}`
}

/** The key entries and selections are tracked by. */
export function entryKey(entry: DriveEntry): string {
  return entry.path
}
