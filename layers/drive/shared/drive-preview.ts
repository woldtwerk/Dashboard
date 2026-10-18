/**
 * Decides whether a file may be shown inline (in an `<img>`, `<iframe>` or
 * `<pre>`) and with which content type. Everything not explicitly safe is served
 * as a download, so a stored HTML, SVG or script file can never run as the
 * dashboard's own origin.
 */

/** Raster images a browser can render safely; SVG is deliberately not here. */
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

const RASTER_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif'
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

/**
 * The content type to serve `name` with inline, or undefined when it must be a
 * download. `mediaType` is the type the provider reported, if any.
 */
export function previewContentType(mediaType: string | undefined, name: string): string | undefined {
  const type = baseType(mediaType)
  const extension = extensionOf(name)

  if (type === 'application/pdf' || extension === 'pdf') {
    return 'application/pdf'
  }
  if (RASTER_TYPES.has(type)) {
    return type
  }
  if (RASTER_EXTENSIONS[extension]) {
    return RASTER_EXTENSIONS[extension]
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
const RASTER_TYPE = /^image\/(?:png|jpe?g|gif|webp|avif)$/

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
