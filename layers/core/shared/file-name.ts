import { extensionForMimeType, fileExtension } from './mime'
import { FILE_NAME_MAX_BYTES } from './file-preview'

/** The longest file name most filesystems accept, in UTF-8 bytes */
export const DRIVE_FILE_NAME_MAX_BYTES = FILE_NAME_MAX_BYTES

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

  if (byteLength(name) <= FILE_NAME_MAX_BYTES) {
    return name
  }

  const dot = name.lastIndexOf('.')
  const extension = dot > 0 && dot < name.length - 1 ? name.slice(dot) : ''
  const extensionBytes = byteLength(extension)
  if (extensionBytes >= FILE_NAME_MAX_BYTES) {
    return truncateToBytes(extension, FILE_NAME_MAX_BYTES)
  }

  const stem = truncateToBytes(name.slice(0, name.length - extension.length), FILE_NAME_MAX_BYTES - extensionBytes).trimEnd()
  return stem ? `${stem}${extension}` : attachmentFallbackName(original, contentType, index)
}
