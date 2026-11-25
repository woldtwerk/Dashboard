/**
 * Logic the Web Push service worker shares with tests. It has no DOM or worker
 * globals, so it runs in plain Node.
 */

/** Only paths on this origin may be opened; `//host` would leave the dashboard. */
export function sameOriginPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return undefined
  }
  return value
}

/**
 * Requests the navigation fallback must not handle: private data, MCP and
 * client access. HTML is never cached, so the app's own user payload does not
 * stay on the device after logout.
 */
export const NAVIGATION_DENYLIST: RegExp[] = [
  /^\/api\//,
  /^\/_client-access\//,
  /^\/mcp(?:\/|$)/
]

/** Whether a navigation may fall back to the offline page. */
export function isCacheableNavigation(pathname: string): boolean {
  return !NAVIGATION_DENYLIST.some(pattern => pattern.test(pathname))
}

export interface NotificationContent {
  title: string
  options: {
    body?: string
    tag?: string
    data: { to?: string }
    icon: string
  }
}

/** Turns a push payload into the title and options `showNotification` takes. */
export function notificationFromPayload(payload: unknown): NotificationContent {
  const data = payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const title = typeof data.title === 'string' && data.title ? data.title : 'Allmight'
  const body = typeof data.body === 'string' && data.body ? data.body : undefined
  const tag = typeof data.id === 'string' && data.id ? data.id : undefined

  return {
    title,
    options: { body, tag, data: { to: sameOriginPath(data.to) }, icon: '/pwa-192x192.png' }
  }
}
