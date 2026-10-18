import type { H3Event } from 'h3'
import { createError, defineEventHandler, getQuery, getRouterParam } from 'nuxt/server'
import { verifySource } from '../../../utils/imgproxy'
import { getImageSource } from '../../../utils/image-sources'
import type { ImageSourceResult } from '../../../utils/image-sources'
import { decodeImageId } from '../../../../shared/image-id'

/**
 * The original imgproxy reads: `/api/image-source/<source>/<id>?v=&sig=`.
 *
 * imgproxy has no session, so this route is on the login's public allow-list.
 * The HMAC over source, id and version is its protection: only the derivative
 * endpoint, which holds NUXT_IMAGE_SOURCE_SECRET, can produce a URL imgproxy
 * will be able to fetch. The id is never logged at info level — it may hold a
 * personal file name.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const logger = useServiceLogger('image')

  const sourceName = getRouterParam(event, 'source')
  const id = decodeImageId(getRouterParam(event, 'id'))
  const query = getQuery(event)
  const version = typeof query.v === 'string' ? query.v : ''
  const signature = typeof query.sig === 'string' ? query.sig : undefined

  if (!sourceName || !id || !verifySource(sourceName, id, version, signature, config.imageSourceSecret)) {
    throw createError({ status: 403, statusText: 'Invalid image source signature' })
  }

  const source = getImageSource(sourceName)
  if (!source) {
    throw createError({ status: 404, statusText: 'Unknown image source' })
  }

  let result: ImageSourceResult
  try {
    result = await source.load(id, event as unknown as H3Event)
  } catch (error) {
    // The file name is part of the id, so the cause stays at debug level
    logger.warn('Could not read an image original', { source: sourceName })
    logger.debug('Image original failed', { error: String(error) })
    throw createError({ status: 502, statusText: 'The original could not be read' })
  }

  const headers = new Headers()
  headers.set('content-type', result.contentType)
  if (result.size !== undefined) {
    headers.set('content-length', String(Math.max(0, Math.trunc(result.size))))
  }
  headers.set('cache-control', 'private, max-age=31536000, immutable')
  headers.set('x-content-type-options', 'nosniff')

  return new Response(result.body as BodyInit, { status: 200, headers })
})
