import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { AuthUser } from '../../shared/types/auth'
import type { Database } from './client'
import { users } from './schema'

/** Only the repository and the login verify step may see this. */
export interface UserRecord extends AuthUser {
  passwordHash: string
  createdAt: Date
}

export interface NewUser {
  email: string
  name: string
  password: string
}

const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** How many accounts exist; the setup route only allows the first one. */
export async function countUsers(db: Database): Promise<number> {
  const row = await db.select({ count: sql<number>`count(*)` }).from(users).get()

  return Number(row?.count ?? 0)
}

/** The account for an email, compared lower-case; carries the password hash. */
export async function findUserByEmail(db: Database, email: string): Promise<UserRecord | undefined> {
  return await db.select().from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .get() as UserRecord | undefined
}

/**
 * Creates the account, hashing the password with nuxt-auth-utils' scrypt
 * helper. Returns the public user; the hash never leaves the repository.
 * A duplicate email is rejected by the unique constraint on `users.email`.
 */
export async function createUser(db: Database, user: NewUser): Promise<AuthUser> {
  const [created] = await db.insert(users)
    .values({
      id: randomUUID(),
      email: normalizeEmail(user.email),
      name: user.name.trim(),
      passwordHash: await hashPassword(user.password),
      createdAt: new Date()
    })
    .returning({ id: users.id, email: users.email, name: users.name })

  return created as AuthUser
}
