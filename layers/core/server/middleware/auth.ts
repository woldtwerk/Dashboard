import { getRequestURL } from 'h3'
import type { H3Event } from 'h3'
import { createError, defineEventHandler } from 'nuxt/server'
import { isPublicApiPath } from '../utils/auth-paths'

/**
 * Every `/api/*` call needs a session, except the login routes and the
 * nuxt-auth-utils routes. Pages, assets, `/mcp` (Bearer tokens) and the rest
 * never reach the session check.
 */
export default defineEventHandler(async (event) => {
  // The normalized pathname, so a `..` segment cannot dodge the rule
  const pathname = getRequestURL(event as unknown as H3Event).pathname

  if (isPublicApiPath(pathname)) {
    return
  }

  const { user } = await getUserSession(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
})
