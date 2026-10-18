import { randomUUID } from 'node:crypto'

export const LOGIN_FAILURE_STATUS = 401
export const LOGIN_FAILURE_MESSAGE = 'Email or password is wrong'

export interface LoginAccount {
  passwordHash: string
}

export type VerifyPassword = (hash: string, plainPassword: string) => Promise<boolean>

let dummy: Promise<string> | undefined

/**
 * A scrypt hash of a random value nobody knows, created once per worker. The
 * login verifies every password against a hash like this, so an unknown account
 * costs the same as a wrong password and the two cannot be told apart. Making it
 * at runtime keeps it in the exact format the module's own `verifyPassword` reads.
 */
export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashPassword(randomUUID())
  return dummy
}

export interface LoginCheck<A extends LoginAccount> {
  /** The stored account, or undefined when the email is unknown. */
  account: A | undefined
  password: string
  verify: VerifyPassword
  dummyHash: () => Promise<string>
}

export type LoginResult<A extends LoginAccount> = { ok: true, account: A } | { ok: false, statusCode: number, statusMessage: string }

/**
 * Checks one login attempt. An unknown account still runs `verify` against the
 * dummy hash, and both failure paths return the very same answer, so neither the
 * response nor the timing reveals which emails exist.
 */
export async function checkLogin<A extends LoginAccount>({ account, password, verify, dummyHash }: LoginCheck<A>): Promise<LoginResult<A>> {
  const valid = await verify(account?.passwordHash ?? await dummyHash(), password)

  if (!account || !valid) {
    return { ok: false, statusCode: LOGIN_FAILURE_STATUS, statusMessage: LOGIN_FAILURE_MESSAGE }
  }

  return { ok: true, account }
}
