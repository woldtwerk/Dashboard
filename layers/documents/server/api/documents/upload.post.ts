import { Readable } from 'node:stream'
import { getRequestWebStream } from 'h3'
import type { H3Event } from 'h3'
import { defineEventHandler, getRequestHeader, getValidatedQuery } from 'nuxt/server'

/** The raw request body as a web stream; on the Node listener it comes from `req`. */
function requestBody(event: H3Event): ReadableStream<Uint8Array> | undefined {
  const req = event.node?.req
  if (req) {
    return Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>
  }
  return getRequestWebStream(event)
}

// Streams the browser's multipart upload straight through to the provider, so a
// large file is never buffered here. Field names mirror the provider's own API.
export default defineEventHandler(async (event) => {
  const { service } = await getValidatedQuery(event, documentsServiceSchema)

  const taskId = await (await useDocumentsProvider(service)).upload({
    // Nuxt's RequestEvent is a narrower type than h3's H3Event; cast at the h3 boundary
    stream: requestBody(event as unknown as H3Event) ?? null,
    contentType: getRequestHeader(event, 'content-type'),
    contentLength: getRequestHeader(event, 'content-length')
  })

  return { taskId }
})
