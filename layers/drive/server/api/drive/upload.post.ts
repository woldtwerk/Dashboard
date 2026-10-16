import { defineEventHandler, getRequestHeader, getValidatedQuery } from 'nuxt/server'

// The h3 auto-import is typed against another h3 build; call it through a narrow cast
const readStream = getRequestWebStream as (event: unknown) => ReadableStream<Uint8Array> | undefined

// Forwards the multipart upload to the provider without buffering it. The body
// is streamed straight through, so a large file never sits in memory here.
export default defineEventHandler(async (event) => {
  const { service, path } = await getValidatedQuery(event, drivePathQuerySchema)

  await (await useDriveProvider(service)).upload(path, {
    stream: readStream(event) ?? null,
    contentType: getRequestHeader(event, 'content-type'),
    contentLength: getRequestHeader(event, 'content-length')
  })

  return { ok: true }
})
