import type { DocumentsDocument } from './types/documents'

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** Formats a byte count, e.g. `1.4 MB`. */
export function formatBytes(bytes?: number): string {
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
 * Formats a date or timestamp from its own digits, without the viewer's
 * timezone, so server-rendered and hydrated markup always agree.
 */
export function formatDate(iso?: string): string {
  if (!iso) {
    return '—'
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : iso
}

/** Like {@link formatDate} but with the time part, e.g. `2026-03-15 19:07`. */
export function formatDateTime(iso?: string): string {
  if (!iso) {
    return '—'
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso)
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : iso
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

/** The icon for a document, by its media type. */
export function documentIcon(document: Pick<DocumentsDocument, 'mimeType' | 'title'>): string {
  const mime = document.mimeType ?? ''
  return MIME_ICONS.find(item => item.match.test(mime))?.icon ?? 'i-lucide-file'
}

/**
 * Whether the preview proxy may render this document inline. Only PDFs and
 * raster images are safe; SVG and HTML could carry scripts and are downloads.
 */
export function isInlinePreview(mimeType: string): boolean {
  return mimeType === 'application/pdf' || /^image\/(png|jpe?g|gif|webp|avif|bmp|tiff)$/.test(mimeType)
}

/** A human label for a document's kind, e.g. `PDF document`. */
export function documentKindLabel(mimeType: string): string {
  if (mimeType === 'application/pdf') {
    return 'PDF document'
  }
  if (mimeType.startsWith('image/')) {
    return `${mimeType.slice('image/'.length).toUpperCase()} image`
  }
  if (mimeType.startsWith('text/')) {
    return 'Text file'
  }
  return mimeType || 'Document'
}

/** The display name of a user, e.g. `Willi Woldt` or the username. */
export function userLabel(user: { username: string, firstName?: string, lastName?: string }): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return name || user.username
}
