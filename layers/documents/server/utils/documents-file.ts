import { isInlinePreview } from '../../shared/documents-format'

/** A conservative content type, so nothing a provider says can inject a header. */
const SAFE_TYPE = /^[\w.+-]+\/[\w.+-]+(?:;\s*[\w.-]+=[\w.-]+)*$/

function upstreamType(response: Response): string {
  const value = response.headers.get('content-type') ?? ''
  return SAFE_TYPE.test(value) ? value : 'application/octet-stream'
}

function headerFilename(name: string): string {
  return name.replace(/[^\w .-]/g, '_').slice(0, 200) || 'document'
}

/**
 * Streams a provider file response through untouched in the body, but builds the
 * headers here: the upstream `Content-Disposition` is ignored, inline is only
 * allowed for types that are safe to render (PDF, raster image), and every
 * response is nosniff and sandboxed. Returned directly, so h3 sends it as-is.
 */
export function documentsFileResponse(response: Response, options: { filename: string, inline?: boolean }): Response {
  const type = upstreamType(response)
  const preview = options.inline && isInlinePreview(type) ? type : undefined

  const headers = new Headers()
  headers.set('x-content-type-options', 'nosniff')
  headers.set('content-type', preview ?? type)
  headers.set('content-disposition', `${preview ? 'inline' : 'attachment'}; filename="${headerFilename(options.filename)}"`)
  // Inline PDFs/images need their viewer, so they get the plain sandbox; downloads get the strictest policy
  headers.set('content-security-policy', preview ? 'sandbox' : 'sandbox; default-src \'none\'')
  const length = response.headers.get('content-length')
  if (length) {
    headers.set('content-length', length)
  }

  return new Response(response.body, { status: response.status, headers })
}
