/**
 * URL checks for values that arrive from a client and are then used to make an
 * authenticated request. A DAV object URL is only safe to touch once it is
 * proven to sit inside a collection the server already trusts.
 */

export function parseUrl(value: string | undefined): URL | undefined {
  if (!value) {
    return undefined
  }
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

function stripTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '')
}

/** Whether two absolute URLs share scheme, host and port. */
export function sameOrigin(a: string | undefined, b: string | undefined): boolean {
  const left = parseUrl(a)
  const right = parseUrl(b)
  return !!left && !!right && left.origin === right.origin
}

/** Whether two URLs name the same resource, ignoring a trailing slash. */
export function sameUrl(a: string | undefined, b: string | undefined): boolean {
  const left = parseUrl(a)
  const right = parseUrl(b)
  if (!left || !right) {
    return false
  }
  return left.origin === right.origin && stripTrailingSlash(left.pathname) === stripTrailingSlash(right.pathname)
}

/**
 * A path segment that escapes its directory. A WHATWG URL already folds plain
 * `.`/`..`, so only an encoded form can survive parsing — decode it.
 */
function hasTraversal(pathname: string): boolean {
  let decoded = pathname
  for (let round = 0; round < 3; round++) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) {
        break
      }
      decoded = next
    } catch {
      // Malformed encoding is not a path we understand
      return true
    }
  }
  return decoded.split('/').some(segment => segment === '..' || segment === '.')
}

/** Resolves a possibly-relative href against a base URL, returning its absolute form. */
export function resolveHref(base: string, href: string | undefined): string | undefined {
  const parsed = parseUrl(base)
  if (!parsed || !href) {
    return undefined
  }
  try {
    return new URL(href, parsed).href
  } catch {
    return undefined
  }
}

/**
 * Whether two hrefs name the same resource once resolved against `base`, so a
 * relative href from a DAV report compares equal to an absolute URL.
 */
export function sameResolvedUrl(base: string, a: string | undefined, b: string | undefined): boolean {
  const left = resolveHref(base, a)
  const right = resolveHref(base, b)
  return !!left && !!right && sameUrl(left, right)
}

/**
 * Whether `candidate` is an object inside `collection`: same origin, a path
 * below the collection's own, and no `..` or encoded traversal.
 */
export function isUrlWithin(collection: string | undefined, candidate: string | undefined): boolean {
  const base = parseUrl(collection)
  const target = parseUrl(candidate)
  if (!base || !target || base.origin !== target.origin) {
    return false
  }
  if (hasTraversal(target.pathname)) {
    return false
  }

  const prefix = stripTrailingSlash(base.pathname)
  return target.pathname.startsWith(`${prefix}/`) && target.pathname.length > prefix.length + 1
}
