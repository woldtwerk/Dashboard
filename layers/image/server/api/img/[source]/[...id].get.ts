import { sendWebResponse } from 'h3'
import type { H3Event } from 'h3'
import { createError, defineEventHandler, getQuery, getRequestHeader, getRouterParam } from 'nuxt/server'
import { buildImgproxyPath, normalizeImageRequest, signImgproxyPath, signSource } from '../../../utils/imgproxy'
import type { ImageRequest } from '../../../utils/imgproxy'
import { getImageSource } from '../../../utils/image-sources'
import { decodeImageId, encodeImageId } from '../../../../shared/image-id'

/** Headers imgproxy decides and the browser, not this route, has to see. */
const FORWARDED_HEADERS = ['content-type', 'content-length', 'etag', 'vary'] as const

/**
 * The derivative the browser asks for: `/api/img/<source>/<id>?w=&h=&fit=&dpr=&v=`.
 *
 * The route is under `/api`, so the login middleware protects it — the browser
 * is authenticated, imgproxy never is. It builds the source URL the original is
 * read from, signs it, signs the imgproxy path and streams the derivative back
 * from the cache. Only the cache is ever addressed, so a render cannot bypass it.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const logger = useServiceLogger('image')

  const sourceName = getRouterParam(event, 'source')
  const id = decodeImageId(getRouterParam(event, 'id'))
  const source = sourceName ? getImageSource(sourceName) : undefined
  if (!sourceName || !id || !source) {
    throw createError({ status: 404, statusText: 'Unknown image source' })
  }

  const imgproxyBase = (config.imgproxy.url ?? '').replace(/\/+$/, '')
  const sourceBase = (config.imageSourceUrl ?? '').replace(/\/+$/, '')
  if (!imgproxyBase || !sourceBase) {
    throw createError({ status: 500, statusText: 'The image service is not configured' })
  }

  const query = getQuery(event)
  let request: ImageRequest
  try {
    request = normalizeImageRequest(query)
  } catch (error) {
    // normalizeImageRequest already answers 400 for a size the layout may not ask for
    logger.warn('Rejected image request', { source: sourceName, error: String(error) })
    throw error
  }

  const rawVersion = query.v
  const version = (typeof rawVersion === 'string' && rawVersion) || source.version?.(id) || ''

  const sourceQuery = new URLSearchParams()
  if (version) {
    sourceQuery.set('v', version)
  }
  sourceQuery.set('sig', signSource(sourceName, id, version, config.imageSourceSecret))
  const sourceUrl = `${sourceBase}/api/image-source/${encodeURIComponent(sourceName)}/${encodeImageId(id)}?${sourceQuery}`

  const path = buildImgproxyPath({ ...request, sourceUrl })
  const signature = signImgproxyPath(path, config.imgproxy.key ?? '', config.imgproxy.salt ?? '')
  const upstreamUrl = `${imgproxyBase}/${signature}${path}`

  // imgproxy answers with AVIF or WebP depending on this header, so it has to
  // reach it unchanged — the cache keys its entries on it as well.
  const accept = getRequestHeader(event, 'accept')
  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, { headers: accept ? { accept } : {} })
  } catch (error) {
    logger.warn('The image cache is unreachable', { source: sourceName, error: String(error) })
    throw createError({ status: 502, statusText: 'The image cache is unreachable' })
  }

  if (!upstream.ok || !upstream.body) {
    logger.warn('The image cache could not render the derivative', { source: sourceName, status: upstream.status })
    throw createError({ status: 502, statusText: 'The image could not be rendered' })
  }

  const headers = new Headers()
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) {
      headers.set(name, value)
    }
  }
  // A version is part of the source signature, so these bytes never change
  // under this URL; without one the entry is short-lived instead.
  headers.set('cache-control', version
    ? 'private, max-age=31536000, immutable'
    : 'private, max-age=300')

  // Nuxt's RequestEvent is a narrower type than h3's H3Event; cast at the h3 boundary
  return sendWebResponse(event as unknown as H3Event, new Response(upstream.body, { status: 200, headers }))
})
