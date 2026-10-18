import { getRequestHeader, getRequestIP, setResponseHeader, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { defineEventHandler } from 'nuxt/server'
import { clientIp } from '../../../../core/server/utils/auth-rate-limit'
import { useClientAccessDeps } from '../../utils/deps'
import { handleDavAuth } from '../../utils/handle-auth'

/**
 * CalDAV/CardDAV auth subrequest of the client-access proxy. It is not under
 * `/api`, so the session middleware does not apply; the shared secret and the
 * app password are the only doors. Reachable from the proxy container only.
 */
export default defineEventHandler(async (event) => {
  // Nuxt's RequestEvent is narrower than h3's H3Event; the Node objects live on the h3 one
  const h3Event = event as unknown as H3Event

  const response = await handleDavAuth({
    secret: getRequestHeader(h3Event, 'x-client-access-secret'),
    authorization: getRequestHeader(h3Event, 'x-original-authorization'),
    ip: clientIp(getRequestHeader(h3Event, 'x-forwarded-for'), getRequestIP(h3Event))
  }, useClientAccessDeps())

  setResponseStatus(h3Event, response.status)
  for (const [name, value] of Object.entries(response.headers)) {
    setResponseHeader(h3Event, name, value)
  }

  return null
})
