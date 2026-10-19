import { createHash } from 'node:crypto'
import { sharedStorage } from './shared-storage'

export const LOGIN_MAX_FAILURES = 5
export const LOGIN_WINDOW_MS = 15 * 60_000

/** Failed logins for one scope (an IP or an email) within the current window. */
export interface LoginAttempt {
  failures: number
  /** Epoch ms when the window ends and the counter is irrelevant again. */
  expiresAt: number
}

export interface LoginAttemptState {
  blocked: boolean
  /** Seconds until the window ends, for a `Retry-After` header. */
  retryAfterSeconds: number
}

/**
 * Decides whether an attempt is over the limit right now. Takes the stored
 * attempt and the clock, so the decision is testable without any storage.
 */
export function loginAttemptState(attempt: LoginAttempt | undefined, now: number): LoginAttemptState {
  if (!attempt || attempt.failures < LOGIN_MAX_FAILURES || now >= attempt.expiresAt) {
    return { blocked: false, retryAfterSeconds: 0 }
  }

  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((attempt.expiresAt - now) / 1000))
  }
}

/** Counts one more failure, starting a fresh window when the old one has passed. */
export function nextLoginAttempt(attempt: LoginAttempt | undefined, now: number): LoginAttempt {
  if (!attempt || now >= attempt.expiresAt) {
    return { failures: 1, expiresAt: now + LOGIN_WINDOW_MS }
  }

  return { failures: attempt.failures + 1, expiresAt: attempt.expiresAt }
}

/**
 * The address to rate limit on. A reverse proxy appends the address it saw to
 * `X-Forwarded-For`, so the last entry is the one the trusted proxy in front of
 * the app added; earlier entries are client-controlled and must not be trusted.
 * Falls back to the socket address when no header is present.
 */
export function clientIp(xForwardedFor: string | undefined, remoteAddress: string | undefined): string {
  const forwarded = xForwardedFor
    ?.split(',')
    .map(entry => entry.trim())
    .filter(Boolean)

  const forwardedIp = forwarded?.at(-1)
  if (forwardedIp) {
    return forwardedIp
  }

  return remoteAddress?.trim() || 'unknown'
}

// Redis when mounted (shared by every cluster worker), else the default Nitro storage
function authStorage() {
  return sharedStorage()
}

// Hashed so neither the client address nor the email itself lands in the cache
function attemptKey(scope: 'ip' | 'email', value: string): string {
  return `auth:login:${scope}:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`
}

async function readAttempt(key: string): Promise<LoginAttempt | undefined> {
  try {
    return await authStorage().getItem<LoginAttempt>(key) ?? undefined
  } catch {
    // A broken cache must not lock everybody out
    return undefined
  }
}

async function writeAttempt(key: string, attempt: LoginAttempt, now: number): Promise<void> {
  try {
    const ttl = Math.max(1, Math.ceil((attempt.expiresAt - now) / 1000))
    await authStorage().setItem(key, attempt, { ttl })
  } catch {
    // A failing cache only means the limit is not enforced
  }
}

export interface LoginAttempts {
  ip: LoginAttempt | undefined
  email: LoginAttempt | undefined
}

export async function readLoginAttempts(ip: string, email: string): Promise<LoginAttempts> {
  const [ipAttempt, emailAttempt] = await Promise.all([
    readAttempt(attemptKey('ip', ip)),
    readAttempt(attemptKey('email', email))
  ])

  return { ip: ipAttempt, email: emailAttempt }
}

export async function registerLoginFailure(ip: string, email: string, now = Date.now()): Promise<void> {
  const attempts = await readLoginAttempts(ip, email)

  await Promise.all([
    writeAttempt(attemptKey('ip', ip), nextLoginAttempt(attempts.ip, now), now),
    writeAttempt(attemptKey('email', email), nextLoginAttempt(attempts.email, now), now)
  ])
}

/** A successful login clears the email counter; the IP counter stays. */
export async function resetLoginEmail(email: string): Promise<void> {
  try {
    await authStorage().removeItem(attemptKey('email', email))
  } catch {
    // Ignore: the email counter expires on its own
  }
}
