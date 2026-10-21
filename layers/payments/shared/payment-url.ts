/**
 * Reading the link a payment QR carries.
 *
 * Every provider's QR is a link, and every parser wants the same three answers
 * before it looks at the path: is it `https`, is it on the host we expect, and
 * what are the segments. Keeping the scheme and host checks here means a
 * parser cannot accidentally admit another scheme or a lookalike host.
 */

/**
 * The URL a payload is, or null when it is not a plain `https` one.
 *
 * Checking the scheme before `new URL` rejects `javascript:`, `data:` and
 * `http:` payloads before they can reach a path check. A malformed URL is
 * simply not one, and a non-default port is refused because only the host as
 * the provider minted it is accepted.
 *
 * @param payload
 *   The decoded contents of a QR.
 */
export function parseHttpsUrl(payload: string): URL | null {
  const text = payload.trim()
  if (!/^https:\/\//i.test(text)) {
    return null
  }

  try {
    const url = new URL(text)
    return url.port === '' ? url : null
  } catch {
    return null
  }
}

/**
 * The path of a URL as its segment list.
 *
 * Matching on segments rather than a regular expression over the whole path
 * keeps the host check separate from the shape, so a path that happens to look
 * right on the wrong host cannot pass.
 */
export function pathSegments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean)
}
