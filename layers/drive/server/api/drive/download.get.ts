import { sendWebResponse } from 'h3'
import type { H3Event } from 'h3'
import { defineEventHandler, getRequestHeader, getValidatedQuery } from 'nuxt/server'
import { baseName } from '../../../shared/drive-path'
import { matchesEtag } from '../../../shared/drive-preview'
import { driveFileResponse, PRIVATE_CACHE } from '../../utils/drive-file'

// Streams the selected entries back; a single file as itself, several as a zip.
// The headers, including the preview policy, are built by driveFileResponse.
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

  // Nuxt's RequestEvent is a narrower type than h3's H3Event; cast at the h3 boundary
  return sendWebResponse(event as unknown as H3Event, driveFileResponse(response, { name, inline, single, etag }))
})
