import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postLoginRedirect, safeRedirect } from '../app/utils/auth'
import { createDatabase, openSqlite } from '../server/db/client'
import type { Database } from '../server/db/client'
import { loadMigrations, runMigrations } from '../server/db/migrate'
import { users } from '../server/db/schema'
import { countUsers, createUser, findUserByEmail } from '../server/db/user-repository'
import { isPublicApiPath, normalizeRequestPath } from '../server/utils/auth-paths'
import { checkLogin, LOGIN_FAILURE_MESSAGE } from '../server/utils/auth-login'
import type { VerifyPassword } from '../server/utils/auth-login'
import { clientIp, loginAttemptState, nextLoginAttempt } from '../server/utils/auth-rate-limit'

const migrationsDir = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

describe('isPublicApiPath', () => {
  it('lets everything outside /api through', () => {
    expect(isPublicApiPath('/')).toBe(true)
    expect(isPublicApiPath('/services')).toBe(true)
    expect(isPublicApiPath('/mcp')).toBe(true)
    expect(isPublicApiPath('/_nuxt/entry.js')).toBe(true)
    expect(isPublicApiPath('/sw.js')).toBe(true)
    expect(isPublicApiPath('')).toBe(true)
  })

  it('allows only the login routes under /api', () => {
    expect(isPublicApiPath('/api/auth/setup')).toBe(true)
    expect(isPublicApiPath('/api/auth/login')).toBe(true)
    expect(isPublicApiPath('/api/auth/state')).toBe(true)
    expect(isPublicApiPath('/api/_auth/session')).toBe(true)

    expect(isPublicApiPath('/api/services')).toBe(false)
    expect(isPublicApiPath('/api/auth')).toBe(false)
    expect(isPublicApiPath('/api/authx')).toBe(false)
    expect(isPublicApiPath('/api/auth/state/anything')).toBe(false)
  })

  it('ignores a query string and a trailing slash', () => {
    expect(isPublicApiPath('/api/auth/login?redirect=/services')).toBe(true)
    expect(isPublicApiPath('/api/auth/login#form')).toBe(true)
    expect(isPublicApiPath('/api/auth/login/')).toBe(true)
    expect(isPublicApiPath('/api/_auth/session/')).toBe(true)
  })

  it('resolves dot segments before deciding', () => {
    expect(isPublicApiPath('/api/auth/login/../services')).toBe(false)
    expect(isPublicApiPath('/api/auth/state/../../services')).toBe(false)
    expect(isPublicApiPath('/api/other/../auth/login')).toBe(true)
    expect(normalizeRequestPath('/api//auth/./login?x=1')).toBe('/api/auth/login')
  })

  it('keeps the route names case-sensitive but the /api prefix protected', () => {
    expect(isPublicApiPath('/API/auth/login')).toBe(false)
    expect(isPublicApiPath('/api/AUTH/login')).toBe(false)
  })
})

describe('safeRedirect', () => {
  it('keeps a same-origin path', () => {
    expect(safeRedirect('/mail')).toBe('/mail')
    expect(safeRedirect('/mail?folder=inbox')).toBe('/mail?folder=inbox')
    expect(safeRedirect('/')).toBe('/')
  })

  it('falls back for anything that leaves the origin or is not a path', () => {
    expect(safeRedirect(undefined)).toBe('/')
    expect(safeRedirect(null)).toBe('/')
    expect(safeRedirect('')).toBe('/')
    expect(safeRedirect('mail')).toBe('/')
    expect(safeRedirect('https://evil.example')).toBe('/')
    expect(safeRedirect('//evil.example')).toBe('/')
    expect(safeRedirect('/\\evil.example')).toBe('/')
    expect(safeRedirect(['/mail', '/other'])).toBe('/')
    expect(safeRedirect(' /mail')).toBe('/')
  })

  it('accepts its own fallback', () => {
    expect(safeRedirect('https://evil.example', '/login')).toBe('/login')
  })
})

describe('postLoginRedirect', () => {
  it('never returns to the login page', () => {
    expect(postLoginRedirect('/mail')).toBe('/mail')
    expect(postLoginRedirect('/login')).toBe('/')
    expect(postLoginRedirect('/login?redirect=/mail')).toBe('/')
    expect(postLoginRedirect('/login#form')).toBe('/')
    expect(postLoginRedirect('https://evil.example')).toBe('/')
  })
})

describe('loginAttemptState', () => {
  const now = Date.UTC(2026, 9, 18, 10, 0, 0)

  it('does not block before the limit', () => {
    expect(loginAttemptState(undefined, now)).toEqual({ blocked: false, retryAfterSeconds: 0 })
    expect(loginAttemptState({ failures: 4, expiresAt: now + 60_000 }, now)).toEqual({ blocked: false, retryAfterSeconds: 0 })
  })

  it('blocks at the limit and reports the remaining window', () => {
    expect(loginAttemptState({ failures: 5, expiresAt: now + 60_000 }, now)).toEqual({ blocked: true, retryAfterSeconds: 60 })
    expect(loginAttemptState({ failures: 7, expiresAt: now + 61_000 }, now).retryAfterSeconds).toBe(61)
  })

  it('forgets an expired window', () => {
    expect(loginAttemptState({ failures: 5, expiresAt: now }, now)).toEqual({ blocked: false, retryAfterSeconds: 0 })
    expect(loginAttemptState({ failures: 5, expiresAt: now - 1 }, now)).toEqual({ blocked: false, retryAfterSeconds: 0 })
  })
})

describe('nextLoginAttempt', () => {
  const now = Date.UTC(2026, 9, 18, 10, 0, 0)

  it('starts a window at the first failure', () => {
    expect(nextLoginAttempt(undefined, now)).toEqual({ failures: 1, expiresAt: now + 15 * 60_000 })
  })

  it('counts up inside the window and keeps its end', () => {
    const expiresAt = now + 5 * 60_000
    expect(nextLoginAttempt({ failures: 4, expiresAt }, now)).toEqual({ failures: 5, expiresAt })
  })

  it('starts over once the window has passed', () => {
    expect(nextLoginAttempt({ failures: 5, expiresAt: now - 1 }, now)).toEqual({ failures: 1, expiresAt: now + 15 * 60_000 })
  })
})

describe('clientIp', () => {
  it('takes the last forwarded entry, the one the trusted proxy appended', () => {
    expect(clientIp('1.2.3.4, 10.0.0.1', '192.168.1.5')).toBe('10.0.0.1')
    expect(clientIp('spoofed, 10.0.0.1, 10.0.0.2', '192.168.1.5')).toBe('10.0.0.2')
  })

  it('ignores a client-supplied entry in front of the proxy one', () => {
    expect(clientIp('203.0.113.9, 10.0.0.1', undefined)).toBe('10.0.0.1')
  })

  it('trims entries and skips empty ones', () => {
    expect(clientIp(' 1.2.3.4 , , 10.0.0.1 ', '127.0.0.1')).toBe('10.0.0.1')
    expect(clientIp(' , ', '127.0.0.1')).toBe('127.0.0.1')
  })

  it('falls back to the socket address', () => {
    expect(clientIp(undefined, '127.0.0.1')).toBe('127.0.0.1')
    expect(clientIp('', '127.0.0.1')).toBe('127.0.0.1')
    expect(clientIp(undefined, undefined)).toBe('unknown')
  })
})

describe('checkLogin', () => {
  const verify: VerifyPassword = async (hash, plain) => hash === 'stored-hash' && plain === 'right-password'
  const dummyHash = async () => 'dummy-hash'

  it('answers the same 401 for an unknown email and a wrong password', async () => {
    const unknown = await checkLogin({ account: undefined, password: 'anything', verify, dummyHash })
    const wrong = await checkLogin({ account: { passwordHash: 'stored-hash' }, password: 'wrong', verify, dummyHash })

    expect(unknown).toEqual({ ok: false, statusCode: 401, statusMessage: LOGIN_FAILURE_MESSAGE })
    expect(wrong).toEqual(unknown)
  })

  it('verifies against the dummy hash for an unknown email', async () => {
    const spy = vi.fn<VerifyPassword>(async () => false)
    const dummy = vi.fn(async () => 'dummy-hash')

    await checkLogin({ account: undefined, password: 'secret', verify: spy, dummyHash: dummy })

    expect(dummy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('dummy-hash', 'secret')
  })

  it('accepts a matching password', async () => {
    const account = { passwordHash: 'stored-hash' }

    await expect(checkLogin({ account, password: 'right-password', verify, dummyHash })).resolves.toEqual({ ok: true, account })
  })
})

describe('dummyPasswordHash', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it('creates one hash per worker and verifies against it without throwing', async () => {
    vi.stubGlobal('hashPassword', async (value: string) => `$scrypt$hashed:${value}`)

    const { checkLogin: freshCheckLogin, dummyPasswordHash: freshDummyHash } = await import('../server/utils/auth-login')
    const dummy = await freshDummyHash()

    expect(dummy).toMatch(/^\$scrypt\$hashed:/)
    // The same promise on the next call: one scrypt run per worker, not per login
    expect(await freshDummyHash()).toBe(dummy)

    // The unknown-email path runs the verify against the dummy and fails cleanly
    const verify: VerifyPassword = async (hash, plain) => hash === `$scrypt$hashed:${plain}`
    await expect(freshCheckLogin({ account: undefined, password: 'nobody-knows', verify, dummyHash: freshDummyHash }))
      .resolves.toEqual({ ok: false, statusCode: 401, statusMessage: LOGIN_FAILURE_MESSAGE })
  })
})

describe('user repository', () => {
  let directory: string
  let sqlite: ReturnType<typeof openSqlite>
  let db: Database

  beforeEach(async () => {
    // Tests keep their database in a temp directory; .data is never touched
    directory = await mkdtemp(join(tmpdir(), 'allmight-auth-'))
    process.env.NUXT_DATABASE_PATH = join(directory, 'allmight.sqlite')
    sqlite = openSqlite(process.env.NUXT_DATABASE_PATH)
    runMigrations(sqlite, await loadMigrations(readMigration))
    db = createDatabase(sqlite)

    // nuxt-auth-utils' hashPassword is a Nitro auto-import, so it is a global here
    vi.stubGlobal('hashPassword', async (password: string) => createHash('sha256').update(`hashed:${password}`).digest('hex'))
  })

  afterEach(async () => {
    sqlite.close()
    vi.unstubAllGlobals()
    delete process.env.NUXT_DATABASE_PATH
    await rm(directory, { recursive: true, force: true })
  })

  it('counts the accounts', async () => {
    expect(await countUsers(db)).toBe(0)

    await createUser(db, { email: 'owner@example.com', name: 'Owner', password: 'long-enough-password' })

    expect(await countUsers(db)).toBe(1)
  })

  it('lower-cases the email, trims the name and hashes the password', async () => {
    const user = await createUser(db, { email: '  Owner@Example.com ', name: ' Owner ', password: 'correct horse battery staple' })

    expect(user).toMatchObject({ email: 'owner@example.com', name: 'Owner' })
    expect(user).not.toHaveProperty('passwordHash')

    const rows = await db.select().from(users)
    const row = rows[0]!
    expect(row).toMatchObject({ email: 'owner@example.com', name: 'Owner' })
    expect(row.passwordHash).not.toBe('correct horse battery staple')
    expect(row.passwordHash).toMatch(/^[0-9a-f]{64}$/)

    expect(await findUserByEmail(db, 'OWNER@example.com')).toMatchObject({ id: user.id })
  })

  it('leaves an unknown email undefined', async () => {
    expect(await findUserByEmail(db, 'nobody@example.com')).toBeUndefined()
  })

  it('rejects a duplicate email, whatever its case', async () => {
    await createUser(db, { email: 'owner@example.com', name: 'Owner', password: 'long-enough-password' })

    await expect(createUser(db, { email: 'OWNER@example.com', name: 'Second', password: 'another-long-password' })).rejects.toThrow()
    expect(await countUsers(db)).toBe(1)
  })
})
