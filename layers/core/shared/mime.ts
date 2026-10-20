/**
 * A small media-type map for attachments. Mail often carries a video as
 * `application/octet-stream`, so the file name's extension is the only clue to
 * what it is. Deliberately not the `mime` package: it is only a transitive
 * dependency and the handful of types an attachment flow sees is enough.
 */

export const MIME_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  avi: 'video/x-msvideo',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  html: 'text/html',
  ics: 'text/calendar',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webm: 'video/webm',
  webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip'
}

const EXTENSIONS_BY_MIME: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MIME_TYPES_BY_EXTENSION).map(([extension, mimeType]) => [mimeType, extension])
)

/** The media type without its parameters, lower-cased */
export function baseMimeType(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0]!.trim().toLocaleLowerCase()
}

/** The lower-case extension of a file name, without its dot */
export function fileExtension(filename: string): string | undefined {
  const base = filename.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLocaleLowerCase() : undefined
}

/** The media type an extension stands for, if the map knows it */
export function mimeTypeForExtension(extension: string): string | undefined {
  return MIME_TYPES_BY_EXTENSION[extension.trim().toLocaleLowerCase()]
}

/** The usual extension for a media type, for a fallback file name */
export function extensionForMimeType(contentType: string | undefined): string | undefined {
  return EXTENSIONS_BY_MIME[baseMimeType(contentType)]
}

/**
 * The media type to trust: a real one as it is, otherwise (empty or the generic
 * `application/octet-stream`) whatever the file's extension says.
 */
export function resolveMimeType(contentType: string | undefined, filename: string): string {
  const type = baseMimeType(contentType)
  if (type && type !== 'application/octet-stream') {
    return type
  }

  const extension = fileExtension(filename)
  return (extension && mimeTypeForExtension(extension)) || 'application/octet-stream'
}
