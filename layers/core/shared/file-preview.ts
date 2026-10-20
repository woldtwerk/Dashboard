/**
 * Decides whether a file may be shown inline (in an `<img>`, `<iframe>`,
 * `<video>`, `<audio>` or `<pre>`) and with which content type. Everything not
 * explicitly safe is served as a download, so a stored HTML, SVG or script file
 * can never run as the dashboard's own origin.
 */

/** A conservative content type, so nothing a provider says can inject a header. */
export const SAFE_TYPE = /^[\w.+-]+\/[\w.+-]+(?:;\s*[\w.-]+=[\w.-]+)*$/

/** Raster images a browser can render safely; SVG is deliberately not here. */
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/tiff'])

const RASTER_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff'
}

/** Video and audio types a browser can play natively. */
const MEDIA_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/mp4'
])

const MEDIA_EXTENSIONS: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4'
}

/** Extensions shown as plain text, never as their own (scriptable) type. */
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'yml', 'yaml', 'ini', 'conf', 'toml', 'env'])

/** Data types that are text and safe to render as such. */
const TEXT_TYPES = new Set(['application/json', 'application/x-ndjson', 'application/yaml'])

const PLAIN_TEXT = 'text/plain; charset=utf-8'

function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name)
  return match ? match[1]!.toLowerCase() : ''
}

function baseType(mediaType?: string): string {
  return (mediaType ?? '').split(';')[0]!.trim().toLowerCase()
}

/** A media type that is safe to write into a header, or the generic fallback. */
export function safeContentType(mediaType: string | undefined): string {
  const value = (mediaType ?? '').trim()
  return SAFE_TYPE.test(value) ? value : 'application/octet-stream'
}

/**
 * The content type to serve `name` with inline, or undefined when it must be a
 * download. `mediaType` is the type the provider reported, if any.
 */
export function previewContentType(mediaType: string | undefined, name: string): string | undefined {
  const type = baseType(mediaType)
  const extension = extensionOf(name)
  const media = MEDIA_EXTENSIONS[extension]

  if (type === 'application/pdf' || extension === 'pdf') {
    return 'application/pdf'
  }
  if (RASTER_TYPES.has(type)) {
    return type
  }
  if (RASTER_EXTENSIONS[extension]) {
    return RASTER_EXTENSIONS[extension]
  }
  if (MEDIA_TYPES.has(type)) {
    return type
  }
  if (media) {
    return media
  }
  // Text is served as plain text, so markup and scripts in it cannot run
  if (TEXT_TYPES.has(type)) {
    return PLAIN_TEXT
  }
  if (type.startsWith('text/') && type !== 'text/html' && type !== 'text/xml' && type !== 'text/svg') {
    return PLAIN_TEXT
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return PLAIN_TEXT
  }

  return undefined
}

/** Downloads get the strictest policy: no scripts, no framing, a sandboxed document. */
export const ATTACHMENT_SECURITY_POLICY = 'sandbox; default-src \'none\''

/** Raster images a browser renders without needing a document sandbox. */
const RASTER_TYPE = /^image\/(?:png|jpe?g|gif|webp|avif|bmp|tiff?)$/

/**
 * The `Content-Security-Policy` for an inline response, by its content type.
 * A PDF gets `frame-ancestors 'self'` and nothing else: a `sandbox` directive
 * stops Chrome from running its built-in viewer, so the iframe would stay blank.
 * Raster images close off resource loading; every other type that may be inline
 * (e.g. `text/plain`) is still sandboxed. Attachments never come through here.
 */
export function inlineSecurityHeaders(contentType: string): string {
  const type = contentType.split(';')[0]!.trim().toLowerCase()
  if (type === 'application/pdf') {
    return 'frame-ancestors \'self\''
  }
  if (RASTER_TYPE.test(type)) {
    return 'default-src \'none\'; frame-ancestors \'self\''
  }
  return 'sandbox; default-src \'none\'; frame-ancestors \'self\''
}

/**
 * Whether an `If-None-Match` header matches the ETag of a versioned inline
 * response, so the request can be answered with `304 Not Modified` without
 * asking the provider for the bytes again.
 */
export function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) {
    return false
  }
  const wanted = etag.trim()
  return header.split(',').some((candidate) => {
    const value = candidate.trim()
    return value === '*' || value.replace(/^W\//, '') === wanted
  })
}

/** The longest file name most filesystems accept, in UTF-8 bytes */
export const FILE_NAME_MAX_BYTES = 255

/** The ASCII fallback in a `Content-Disposition` header. */
export function asciiFileName(name: string, fallback: string): string {
  return name.replace(/[^\w .-]/g, '_').slice(0, 200) || fallback
}

/** RFC 5987 encoding for the `filename*` parameter. */
export function encodedFileName(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** `inline` or `attachment`, with an ASCII fallback and the real UTF-8 name. */
export function contentDisposition(inline: boolean, name: string, fallback = 'download'): string {
  return `${inline ? 'inline' : 'attachment'}; filename="${asciiFileName(name, fallback)}"; filename*=UTF-8''${encodedFileName(name)}`
}

/** A human readable byte count, e.g. `1.4 MB`. */
export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) {
    return '—'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

export type FilePreviewKind = 'image' | 'pdf' | 'text' | 'video' | 'audio'

/**
 * How a file can be previewed inline, or undefined when it cannot. Uses the same
 * allowlist as {@link previewContentType}, so a preview never asks for bytes the
 * server would serve as a download.
 */
export function filePreviewKind(mediaType: string | undefined, name: string): FilePreviewKind | undefined {
  const type = baseType(mediaType)
  const extension = extensionOf(name)

  if (type === 'application/pdf' || extension === 'pdf') {
    return 'pdf'
  }
  if (RASTER_TYPES.has(type) || RASTER_EXTENSIONS[extension]) {
    return 'image'
  }
  if (type.startsWith('image/')) {
    return undefined
  }
  if (['video/mp4', 'video/webm', 'video/quicktime'].includes(type) || ['mp4', 'webm', 'mov'].includes(extension)) {
    return 'video'
  }
  if (['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4'].includes(type) || ['mp3', 'wav', 'ogg', 'oga', 'm4a'].includes(extension)) {
    return 'audio'
  }
  if ((type.startsWith('text/') && type !== 'text/html' && type !== 'text/xml' && type !== 'text/svg') || TEXT_EXTENSIONS.has(extension)) {
    return 'text'
  }
  return undefined
}

/** How much of a text file a preview reads by default. */
export const PREVIEW_TEXT_MAX_BYTES = 512 * 1024

export interface LimitedText {
  text: string
  truncated: boolean
}

/**
 * Reads at most `maxBytes` of a text stream, so a huge log or CSV cannot make
 * the browser fetch the whole file just to show a preview. The stream is
 * cancelled once the cap is reached.
 */
export async function readTextUpTo(
  stream: ReadableStream<Uint8Array>,
  maxBytes = PREVIEW_TEXT_MAX_BYTES
): Promise<LimitedText> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (!value?.byteLength) {
        continue
      }
      const remaining = maxBytes - total
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining))
        total += remaining
        truncated = true
        await reader.cancel()
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  let text = ''
  for (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true })
  }
  text += decoder.decode()
  return { text, truncated }
}
