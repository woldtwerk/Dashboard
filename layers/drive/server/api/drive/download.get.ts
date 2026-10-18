import { sendWebResponse } from 'h3'
import type { H3Event } from 'h3'
import { defineEventHandler, getRequestHeader, getValidatedQuery } from 'nuxt/server'
import { baseName } from '../../../shared/drive-path'
import { matchesEtag, previewContentType } from '../../../shared/drive-preview'

/** A conservative content type, so nothing the provider says can inject a header. */
const SAFE_TYPE = /^[\w.+-]+\/[\w.+-]+(?:;\s*[\w.-]+=[\w.-]+)*$/

/** Inline previews are the same bytes until the entry changes, so the browser may keep them. */
const PRIVATE_CACHE = 'private, max-age=86400'

function upstreamType(response: Response): string {
  const value = response.headers.get('content-type') ?? ''
  return SAFE_TYPE.test(value) ? value : 'application/octet-stream'
}

function headerFilename(name: string): string {
  return name.replace(/[^\w .-]/g, '_').slice(0, 200) || 'drive-download'
}

// Streams the selected entries back; a single file as itself, several as a zip.
// The headers are set here, not copied from the provider: a preview is only
// inline for types that are safe to render, everything else is an attachment,
// and every response is nosniff and sandboxed.
export default defineEventHandler(async (event) => {
  const { service, path, inline, v } = await getValidatedQuery(event, driveDownloadQuerySchema)

  const single = path.length === 1
  // The client passes the entry's version for thumbnails, so the ETag is known
  // before the CLI call and a revalidation returns 304 without touching it.
  const etag = inline && single && v ? `"${v}"` : undefined

  if (etag && matchesEtag(getRequestHeader(event, 'if-none-match'), etag)) {
    const headers = new Headers()
    headers.set('etag', etag)
    headers.set('cache-control', PRIVATE_CACHE)
    return sendWebResponse(event as unknown as H3Event, new Response(null, { status: 304, headers }))
  }

  const response = await (await useDriveProvider(service)).download(path)

  const name = single ? baseName(path[0]!) : 'drive-download.zip'
  const type = upstreamType(response)
  const preview = inline && single ? previewContentType(type, name) : undefined

  const headers = new Headers()
  headers.set('x-content-type-options', 'nosniff')
  headers.set('content-type', preview ?? type)
  headers.set('content-disposition', `${preview ? 'inline' : 'attachment'}; filename="${headerFilename(name)}"`)
  // Inline PDFs need their viewer, so they get the plain sandbox; downloads get the strictest policy
  headers.set('content-security-policy', preview ? 'sandbox' : 'sandbox; default-src \'none\'')
  if (etag) {
    headers.set('etag', etag)
    headers.set('cache-control', PRIVATE_CACHE)
  }
  const length = response.headers.get('content-length')
  if (length) {
    headers.set('content-length', length)
  }

  // Nuxt's RequestEvent is a narrower type than h3's H3Event; cast at the h3 boundary
  return sendWebResponse(event as unknown as H3Event, new Response(response.body, { status: response.status, headers }))
})
