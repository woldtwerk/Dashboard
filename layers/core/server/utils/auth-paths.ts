const PUBLIC_API_PATHS = new Set([
  '/api/auth/setup',
  '/api/auth/login',
  '/api/auth/state'
])

/** Everything nuxt-auth-utils serves, e.g. `/api/_auth/session`. */
const AUTH_MODULE_PREFIX = '/api/_auth/'

/**
 * Collapses a request path to its normalized pathname: drops the query and the
 * fragment, and resolves empty, `.` and `..` segments. Percent-encoded segments
 * are left untouched — this only mirrors how the router reads the path, it does
 * not try to decode one.
 */
export function normalizeRequestPath(path: string): string {
  const [pathname = ''] = path.split(/[?#]/)
  const segments: string[] = []

  for (const segment of pathname.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') {
      continue
    }
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  return `/${segments.join('/')}`
}

/**
 * Whether a request path may be served without a session.
 *
 * Everything outside `/api` passes (pages, assets, `/mcp`, `/_nuxt`, `/sw.js`),
 * as do the login routes and the nuxt-auth-utils routes under `/api/_auth/`.
 * The `api` prefix matches case-insensitively so a `/API/...` variant is still
 * protected; the route names themselves stay case-sensitive, so only the exact
 * `/api/auth/login` is public and `/api/authx` is not.
 */
export function isPublicApiPath(path: string): boolean {
  const pathname = normalizeRequestPath(path)
  const [first] = pathname.slice(1).split('/')

  if (first?.toLowerCase() !== 'api') {
    return true
  }

  return PUBLIC_API_PATHS.has(pathname) || pathname.startsWith(AUTH_MODULE_PREFIX)
}
