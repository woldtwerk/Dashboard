import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { H3Event } from 'h3'
import { createError, defineEventHandler, getRequestHeader, getValidatedQuery } from 'nuxt/server'
import { matchesEtag } from '#layers/core/shared/file-preview'
import { fileResponse } from '#layers/core/server/utils/file-response'

/** An attachment is private and unchanged until the mailbox is renumbered. */
const ATTACHMENT_CACHE = 'private, max-age=3600'

/**
 * Streams one attachment part with backpressure. The provider validates that
 * the part is one of the message's attachments; a part it does not list is a
 * 404. There is no Range support, so no `Accept-Ranges` header is advertised.
 */
export default defineEventHandler(async (event) => {
  const uid = getUidParam(event)
  const nodeEvent = event as unknown as H3Event
  const { service, mailbox, part, inline } = await getValidatedQuery(event, mailAttachmentQuerySchema)

  const provider = await useMailProvider(service)
  const opened = provider.openAttachment ? await provider.openAttachment(mailbox, uid, part) : null
  if (!opened) {
    throw createError({ status: 404, statusText: 'Attachment not found' })
  }

  const etag = opened.uidValidity ? `"${opened.uidValidity}:${uid}:${part}"` : undefined
  if (etag && matchesEtag(getRequestHeader(event, 'if-none-match'), etag)) {
    nodeEvent.node.res.writeHead(304, { etag, 'cache-control': ATTACHMENT_CACHE })
    nodeEvent.node.res.end()
    await opened.close()
    return
  }

  const upstream = new Response(opened.stream, {
    headers: { 'content-type': opened.meta.contentType }
  })
  const file = fileResponse(upstream, {
    name: opened.meta.filename,
    inline: inline === true,
    single: true,
    etag,
    fallbackName: 'attachment'
  })
  file.headers.set('cache-control', ATTACHMENT_CACHE)

  for (const [name, value] of file.headers) {
    nodeEvent.node.res.setHeader(name, value)
  }

  // The client went away before the response finished: stop the download and
  // release the provider connection instead of writing into a dead socket.
  // Listening on the request would fire as soon as its (empty GET) body was
  // consumed, so the response is the one that says the transfer really ended.
  const cancel = () => {
    if (nodeEvent.node.res.writableFinished) {
      return
    }
    void opened.stream.cancel().catch(() => {})
    void opened.close()
  }
  nodeEvent.node.res.once('close', cancel)

  try {
    if (!file.body) {
      throw createError({ status: 502, statusText: 'The attachment stream is empty' })
    }
    // Nuxt's RequestEvent is a narrower type than h3's H3Event; the node stream
    // is the one h3/Nitro serve, and pipeline applies its backpressure.
    const body = file.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>
    await pipeline(Readable.fromWeb(body), nodeEvent.node.res).catch(() => {})
  } finally {
    nodeEvent.node.res.off('close', cancel)
    await opened.close()
  }
})
