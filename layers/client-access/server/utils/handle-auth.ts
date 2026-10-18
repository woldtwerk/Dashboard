import type { AppPasswordScope } from '../../../core/shared/types/app-passwords'
import type { AppPasswordAttempt } from '../../../core/server/utils/app-passwords'
import type { MailAuthProtocol } from './client-access-auth'
import { basicAuthHeader, mailAuthHeaders, parseBasicAuth, secretMatches } from './client-access-auth'

/** The upstream DAV credentials of the Proton account, as carbonate issued them. */
export interface DavUpstream {
  username: string
  password: string
}

/** The upstream Bridge mailbox of the Proton account. */
export interface MailUpstream {
  host: string
  user: string
  password: string
}

/**
 * What the endpoints need from the outside. Passing it in keeps the request
 * handling testable without a database, a network or a running Nitro app.
 */
export interface ClientAccessDeps {
  /** The shared secret the proxy presents in X-Client-Access-Secret */
  secret: string
  /** Verifies an app password with the login rate limit applied */
  authenticate: (input: { ip: string, username: string, token: string, scope: AppPasswordScope }) => Promise<AppPasswordAttempt>
  /** The upstream DAV credentials, or undefined when no Proton account is set up */
  davUpstream: () => Promise<DavUpstream | undefined>
  /** The upstream Bridge mailbox, or undefined when no Proton account is set up */
  mailUpstream: () => Promise<MailUpstream | undefined>
  /** Resolves a hostname to an IPv4 address; nginx mail requires an IP */
  resolveHost: (host: string) => Promise<string | undefined>
}

export interface AuthResponse {
  status: number
  headers: Record<string, string>
}

/** A request from the proxy that does not carry the shared secret is invisible. */
const NOT_FOUND: AuthResponse = { status: 404, headers: {} }

const DAV_UNAUTHORIZED: AuthResponse = {
  status: 401,
  headers: { 'WWW-Authenticate': 'Basic realm="Allmight"' }
}

/** The auth endpoint answers `auth_http` over HTTP 200 in both cases. */
const MAIL_FAILED: AuthResponse = { status: 200, headers: mailAuthHeaders({ ok: false }) }

export interface DavAuthInput {
  /** X-Client-Access-Secret */
  secret: string | undefined
  /** X-Original-Authorization, the client's own Authorization header */
  authorization: string | undefined
  /** The client address, for the rate limit */
  ip: string
}

/**
 * The CalDAV/CardDAV auth subrequest nginx makes. A valid app password with the
 * `dav` scope yields the upstream Basic credentials in a response header, so
 * nginx can rewrite the Authorization header of the proxied request.
 */
export async function handleDavAuth(input: DavAuthInput, deps: ClientAccessDeps): Promise<AuthResponse> {
  if (!secretMatches(input.secret, deps.secret)) {
    return NOT_FOUND
  }

  const credentials = parseBasicAuth(input.authorization)
  if (!credentials) {
    return DAV_UNAUTHORIZED
  }

  const result = await deps.authenticate({
    ip: input.ip,
    username: credentials.username,
    token: credentials.password,
    scope: 'dav'
  })
  if (!result.ok) {
    return DAV_UNAUTHORIZED
  }

  const upstream = await deps.davUpstream()
  if (!upstream) {
    return { status: 503, headers: {} }
  }

  return {
    status: 204,
    headers: { 'X-Upstream-Authorization': basicAuthHeader(upstream.username, upstream.password) }
  }
}

export interface MailAuthInput {
  /** X-Client-Access-Secret */
  secret: string | undefined
  /** Auth-Method, e.g. PLAIN or LOGIN */
  method: string | undefined
  /** Auth-User */
  user: string | undefined
  /** Auth-Pass */
  pass: string | undefined
  /** Auth-Protocol: imap or smtp */
  protocol: string | undefined
  /** Client-IP, nginx's view of the client */
  clientIp: string | undefined
}

/**
 * The `auth_http` endpoint nginx mail calls. It resolves the app password to
 * the Bridge mailbox and tells nginx which backend to proxy to. Every failure
 * is an HTTP 200 with a non-OK `Auth-Status`, as the protocol expects.
 */
export async function handleMailAuth(input: MailAuthInput, deps: ClientAccessDeps): Promise<AuthResponse> {
  if (!secretMatches(input.secret, deps.secret)) {
    return NOT_FOUND
  }

  const protocol: MailAuthProtocol | undefined = input.protocol === 'imap' || input.protocol === 'smtp'
    ? input.protocol
    : undefined

  if (!protocol || !input.user || !input.pass) {
    return MAIL_FAILED
  }

  const result = await deps.authenticate({
    ip: input.clientIp ?? 'unknown',
    username: input.user,
    token: input.pass,
    scope: 'mail'
  })
  if (!result.ok) {
    return MAIL_FAILED
  }

  const upstream = await deps.mailUpstream()
  if (!upstream) {
    return MAIL_FAILED
  }

  const server = await deps.resolveHost(upstream.host)
  if (!server) {
    return MAIL_FAILED
  }

  return {
    status: 200,
    headers: mailAuthHeaders({
      ok: true,
      protocol,
      server,
      user: upstream.user,
      password: upstream.password
    })
  }
}
