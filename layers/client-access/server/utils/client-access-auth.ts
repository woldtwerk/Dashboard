import { createHash, timingSafeEqual } from 'node:crypto'

export interface BasicCredentials {
  username: string
  password: string
}

/** A base64 payload, so a malformed header is rejected before it is decoded. */
const BASIC_HEADER = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i

/**
 * The username and password of an `Authorization: Basic` header, if it is well
 * formed. A value without a colon, or with a payload that is not base64, is
 * rejected rather than guessed at.
 */
export function parseBasicAuth(header: string | undefined): BasicCredentials | undefined {
  const match = header?.match(BASIC_HEADER)
  if (!match) {
    return undefined
  }

  const decoded = Buffer.from(match[1]!, 'base64').toString('utf8')
  const separator = decoded.indexOf(':')
  if (separator < 0) {
    return undefined
  }

  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) }
}

/** An `Authorization: Basic` header for a username and password. */
export function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
}

/**
 * Constant-time comparison of a presented secret with the configured one. Both
 * sides are hashed first, so a differing length cannot be observed either.
 */
export function secretMatches(presented: string | undefined, expected: string): boolean {
  const a = createHash('sha256').update(presented ?? '').digest()
  const b = createHash('sha256').update(expected).digest()

  return timingSafeEqual(a, b)
}

export type MailAuthProtocol = 'imap' | 'smtp'

/** Backend ports the proxy sends mail traffic to; the Bridge container's own. */
export const MAIL_AUTH_PORTS: Record<MailAuthProtocol, number> = { imap: 1144, smtp: 1026 }

export type MailAuthDecision
  = | { ok: true, protocol: MailAuthProtocol, server: string, user: string, password: string }
    | { ok: false }

/**
 * The response headers of nginx mail's `auth_http` protocol. `Auth-Server` must
 * be an IP, which is why the caller resolves the host first. A failure carries
 * the same generic message the login uses, so nothing about the account leaks.
 */
export function mailAuthHeaders(decision: MailAuthDecision): Record<string, string> {
  if (!decision.ok) {
    return { 'Auth-Status': 'Invalid login or password', 'Auth-Wait': '3' }
  }

  return {
    'Auth-Status': 'OK',
    'Auth-Server': decision.server,
    'Auth-Port': String(MAIL_AUTH_PORTS[decision.protocol]),
    'Auth-User': decision.user,
    'Auth-Pass': decision.password
  }
}
