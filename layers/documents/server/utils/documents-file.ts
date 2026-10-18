import { isInlinePreview } from '../../shared/documents-format'

/** A conservative content type, so nothing a provider says can inject a header. */
const SAFE_TYPE = /^[\w.+-]+\/[\w.+-]+(?:;\s*[\w.-]+=[\w.-]+)*$/

/** Raster images a browser renders without needing a document sandbox. */
const RASTER_TYPE = /^image\/(?:png|jpe?g|gif|webp|avif)$/

/** Downloads get the strictest policy: no scripts, no framing, a sandboxed document. */
export const ATTACHMENT_SECURITY_POLICY = 'sandbox; default-src \'none\''

function upstreamType(response: Response): string {
  const value = response.headers.get('content-type') ?? ''
  return SAFE_TYPE.test(value) ? value : 'application/octet-stream'
}

function headerFilename(name: string): string {
  return name.replace(/[^\w .-]/g, '_').slice(0, 200) || 'document'
}

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
 * Streams a provider file response through untouched in the body, but builds the
 * headers here: the upstream `Content-Disposition` is ignored, inline is only
 * allowed for types that are safe to render (PDF, raster image), and every
 * response is nosniff with a policy the viewer can actually run under.
 * Returned directly, so h3 sends it as-is.
 */
export function documentsFileResponse(response: Response, options: { filename: string, inline?: boolean }): Response {
  const type = upstreamType(response)
  const preview = options.inline && isInlinePreview(type) ? type : undefined

  const headers = new Headers()
  headers.set('x-content-type-options', 'nosniff')
  headers.set('content-type', preview ?? type)
  headers.set('content-disposition', `${preview ? 'inline' : 'attachment'}; filename="${headerFilename(options.filename)}"`)
  headers.set('content-security-policy', preview ? inlineSecurityHeaders(preview) : ATTACHMENT_SECURITY_POLICY)
  const length = response.headers.get('content-length')
  if (length) {
    headers.set('content-length', length)
  }

  return new Response(response.body, { status: response.status, headers })
}
