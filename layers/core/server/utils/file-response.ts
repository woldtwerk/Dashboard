import {
  ATTACHMENT_SECURITY_POLICY,
  contentDisposition,
  inlineSecurityHeaders,
  previewContentType,
  safeContentType
} from '../../shared/file-preview'

/** Inline previews are the same bytes until the entry changes, so the browser may keep them. */
export const PRIVATE_CACHE = 'private, max-age=86400'

export interface FileResponseOptions {
  /** The name the browser saves the file under */
  name: string
  /** Whether the response may render inline when its type is safe */
  inline?: boolean
  /** A multi-file archive is never inline; single-file responses default to true */
  single?: boolean
  etag?: string
  /** Used when `name` has no characters left after the ASCII sanitizing */
  fallbackName?: string
}

/**
 * Builds a provider's response for a file download. The headers are set here,
 * not copied from the provider: a preview is only inline for types safe to
 * render, anything else is an attachment, and every response is nosniff with a
 * policy its viewer can run under. `name` decides the content type when it is
 * inline and names the file; pass `single: false` for a zip, which is never
 * inline.
 */
export function fileResponse(response: Response, options: FileResponseOptions): Response {
  const type = safeContentType(response.headers.get('content-type') ?? undefined)
  const preview = options.inline && options.single !== false ? previewContentType(type, options.name) : undefined

  const headers = new Headers()
  headers.set('x-content-type-options', 'nosniff')
  headers.set('content-type', preview ?? type)
  headers.set('content-disposition', contentDisposition(!!preview, options.name, options.fallbackName))
  headers.set('content-security-policy', preview ? inlineSecurityHeaders(preview) : ATTACHMENT_SECURITY_POLICY)
  headers.set('cache-control', options.etag ? PRIVATE_CACHE : 'private')
  if (options.etag) {
    headers.set('etag', options.etag)
  }
  const length = response.headers.get('content-length')
  if (length) {
    headers.set('content-length', length)
  }

  return new Response(response.body, { status: response.status, headers })
}
