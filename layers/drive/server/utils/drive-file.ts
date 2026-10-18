import { ATTACHMENT_SECURITY_POLICY, inlineSecurityHeaders, previewContentType } from '../../shared/drive-preview'

/** A conservative content type, so nothing the provider says can inject a header. */
const SAFE_TYPE = /^[\w.+-]+\/[\w.+-]+(?:;\s*[\w.-]+=[\w.-]+)*$/

/** Inline previews are the same bytes until the entry changes, so the browser may keep them. */
export const PRIVATE_CACHE = 'private, max-age=86400'

function upstreamType(response: Response): string {
  const value = response.headers.get('content-type') ?? ''
  return SAFE_TYPE.test(value) ? value : 'application/octet-stream'
}

function headerFilename(name: string): string {
  return name.replace(/[^\w .-]/g, '_').slice(0, 200) || 'drive-download'
}

/**
 * Builds the response for a drive download. The headers are set here, not copied
 * from the provider: a preview is only inline for types safe to render, anything
 * else is an attachment, and every response is nosniff with a policy its viewer
 * can run under. `name` decides the content type when it is inline and names the
 * file; pass `single: false` for a zip, which is never inline.
 */
export function driveFileResponse(
  response: Response,
  options: { name: string, inline?: boolean, single?: boolean, etag?: string }
): Response {
  const type = upstreamType(response)
  const preview = options.inline && options.single ? previewContentType(type, options.name) : undefined

  const headers = new Headers()
  headers.set('x-content-type-options', 'nosniff')
  headers.set('content-type', preview ?? type)
  headers.set('content-disposition', `${preview ? 'inline' : 'attachment'}; filename="${headerFilename(options.name)}"`)
  headers.set('content-security-policy', preview ? inlineSecurityHeaders(preview) : ATTACHMENT_SECURITY_POLICY)
  if (options.etag) {
    headers.set('etag', options.etag)
    headers.set('cache-control', PRIVATE_CACHE)
  }
  const length = response.headers.get('content-length')
  if (length) {
    headers.set('content-length', length)
  }

  return new Response(response.body, { status: response.status, headers })
}
