/**
 * Accepts only a same-origin path as a redirect target: it has to start with a
 * single `/`. Values like `https://evil.example`, `//evil.example` or
 * `/\evil.example` fall back instead of sending the browser off-site.
 */
export function safeRedirect(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return fallback
  }

  if (value.startsWith('//') || value.startsWith('/\\')) {
    return fallback
  }

  return value
}

/**
 * Where to land after signing in. Like `safeRedirect`, but never back on the
 * login page, so a crafted `?redirect=/login` cannot loop.
 */
export function postLoginRedirect(value: unknown, fallback = '/'): string {
  const target = safeRedirect(value, fallback)
  const [path = ''] = target.split(/[?#]/)

  return path === '/login' ? fallback : target
}
