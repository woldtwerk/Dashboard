import { getRequestWebStream } from 'h3'
import type { H3Event } from 'h3'
import { defineEventHandler, getRequestHeader, getValidatedQuery } from 'nuxt/server'

// Forwards the multipart upload to the provider without buffering it. The body
// is streamed straight through, so a large file never sits in memory here.
export default defineEventHandler(async (event) => {
  const { service, path } = await getValidatedQuery(event, drivePathQuerySchema)

  await (await useDriveProvider(service)).upload(path, {
    // Nuxt's RequestEvent is a narrower type than h3's H3Event; cast at the h3 boundary
    stream: getRequestWebStream(event as unknown as H3Event) ?? null,
    contentType: getRequestHeader(event, 'content-type'),
    contentLength: getRequestHeader(event, 'content-length')
  })

  return { ok: true }
})
