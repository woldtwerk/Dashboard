/**
 * The MCP endpoint must not answer a browser request coming from another
 * origin: a malicious page could otherwise talk to a locally running dashboard
 * (DNS rebinding). Requests without an Origin header (Claude Code, curl) are
 * fine.
 */

/** The origin this request was addressed to, honouring a reverse proxy. */
export function requestOrigin(host: string | undefined, forwardedProto: string | undefined, encrypted = false): string | undefined {
  if (!host) {
    return undefined
  }

  const protocol = forwardedProto?.split(',')[0]?.trim() || (encrypted ? 'https' : 'http')

  try {
    return new URL(`${protocol}://${host}`).origin
  } catch {
    return undefined
  }
}

/** Whether a present Origin header names this app; an absent one is allowed. */
export function isAllowedMcpOrigin(origin: string | undefined, ownOrigin: string | undefined): boolean {
  if (!origin) {
    return true
  }

  try {
    return !!ownOrigin && new URL(origin).origin === ownOrigin
  } catch {
    return false
  }
}
