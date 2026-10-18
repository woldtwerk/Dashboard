import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AppPasswordScope } from '../../shared/types/app-passwords'
import { findAppPasswordByHash, touchAppPassword } from '../db/app-password-repository'
import { findOwner } from '../db/user-repository'
import { loginAttemptState, readLoginAttempts, registerLoginFailure, resetLoginEmail } from './auth-rate-limit'

/** Marks a value as an Allmight app password, so it is recognizable in a paste. */
export const APP_PASSWORD_PREFIX = 'amap_'

/** 32 random bytes, base64url encoded; shown to the user exactly once. */
export function generateAppPassword(): string {
  return `${APP_PASSWORD_PREFIX}${randomBytes(32).toString('base64url')}`
}

/** The only form a token is stored in. */
export function hashAppPassword(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison of a presented token with a stored hash. */
export function appPasswordMatchesHash(token: string, storedHash: string): boolean {
  const presented = Buffer.from(hashAppPassword(token), 'hex')
  const stored = Buffer.from(storedHash, 'hex')

  return presented.length === stored.length && timingSafeEqual(presented, stored)
}

/** The first characters, as the list shows them next to the name. */
export function appPasswordPrefix(token: string): string {
  return token.slice(0, 8)
}

export interface AppPasswordAuth {
  id: string
  name: string
  scopes: AppPasswordScope[]
}

/**
 * Resolves a username and token to a live app password. The username is the
 * owner's dashboard email; unknown, malformed, revoked and out-of-scope tokens
 * all resolve to `undefined`, so the caller answers 401 without revealing which
 * case it was.
 */
export async function verifyAppPassword(username: string, token: string, scope: AppPasswordScope): Promise<AppPasswordAuth | undefined> {
  const db = await useDb()
  const owner = await findOwner(db)

  if (!owner || owner.email !== username.trim().toLowerCase()) {
    return undefined
  }

  const row = await findAppPasswordByHash(db, hashAppPassword(token))
  if (!row || row.revokedAt || !row.scopes.includes(scope) || !appPasswordMatchesHash(token, row.tokenHash)) {
    return undefined
  }

  await touchAppPassword(db, row.id, new Date())

  return { id: row.id, name: row.name, scopes: row.scopes }
}

export interface AppPasswordAttempt {
  ok: boolean
  /** Seconds to wait before the next attempt, when the limit is hit */
  retryAfterSeconds?: number
}

/**
 * Applies the login rate limit to app password attempts: five failures per
 * client address or username in fifteen minutes, then blocked. A success clears
 * the username counter; the address counter stays, exactly like the login.
 */
export async function authenticateAppPassword(input: {
  ip: string
  username: string
  token: string
  scope: AppPasswordScope
  now?: number
}): Promise<AppPasswordAttempt> {
  const username = input.username.trim().toLowerCase()
  const now = input.now ?? Date.now()

  const attempts = await readLoginAttempts(input.ip, username)
  const blocked = [attempts.ip, attempts.email]
    .map(attempt => loginAttemptState(attempt, now))
    .reduce((worst, state) => state.retryAfterSeconds > worst.retryAfterSeconds ? state : worst)

  if (blocked.blocked) {
    return { ok: false, retryAfterSeconds: blocked.retryAfterSeconds }
  }

  const auth = await verifyAppPassword(input.username, input.token, input.scope)
  if (!auth) {
    await registerLoginFailure(input.ip, username, now)
    return { ok: false }
  }

  await resetLoginEmail(username)

  return { ok: true }
}
