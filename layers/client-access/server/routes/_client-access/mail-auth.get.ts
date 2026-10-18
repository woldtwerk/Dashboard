import { getRequestHeader, setResponseHeader, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { defineEventHandler } from 'nuxt/server'
import { useClientAccessDeps } from '../../utils/deps'
import { handleMailAuth } from '../../utils/handle-auth'

/**
 * `auth_http` endpoint of the client-access proxy's mail servers. Not under
 * `/api`, so the session middleware does not apply; the shared secret and the
 * app password are the only doors. Reachable from the proxy container only.
 */
export default defineEventHandler(async (event) => {
  // Nuxt's RequestEvent is narrower than h3's H3Event; the Node objects live on the h3 one
  const h3Event = event as unknown as H3Event

  const response = await handleMailAuth({
    secret: getRequestHeader(h3Event, 'x-client-access-secret'),
    method: getRequestHeader(h3Event, 'auth-method'),
    user: getRequestHeader(h3Event, 'auth-user'),
    pass: getRequestHeader(h3Event, 'auth-pass'),
    protocol: getRequestHeader(h3Event, 'auth-protocol'),
    clientIp: getRequestHeader(h3Event, 'client-ip')
  }, useClientAccessDeps())

  setResponseStatus(h3Event, response.status)
  for (const [name, value] of Object.entries(response.headers)) {
    setResponseHeader(h3Event, name, value)
  }

  return null
})
