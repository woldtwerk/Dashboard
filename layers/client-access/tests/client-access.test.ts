import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, openSqlite } from '../../core/server/db/client'
import type { Database } from '../../core/server/db/client'
import { loadMigrations, runMigrations } from '../../core/server/db/migrate'
import { insertAppPassword, revokeAppPassword } from '../../core/server/db/app-password-repository'
import { appPasswords, users } from '../../core/server/db/schema'
import { authenticateAppPassword, generateAppPassword, hashAppPassword, appPasswordMatchesHash, verifyAppPassword } from '../../core/server/utils/app-passwords'
import { readLoginAttempts } from '../../core/server/utils/auth-rate-limit'
import { basicAuthHeader, mailAuthHeaders, parseBasicAuth, secretMatches } from '../server/utils/client-access-auth'
import { handleDavAuth, handleMailAuth } from '../server/utils/handle-auth'
import type { ClientAccessDeps } from '../server/utils/handle-auth'

const migrationsDir = fileURLToPath(new URL('../../core/server/db/migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

const OWNER_EMAIL = 'owner@example.com'
const SECRET = 'shared-proxy-secret'

/** The Nitro storage the login rate limit uses, backed by a Map for the test. */
function memoryStorage() {
  const items = new Map<string, unknown>()

  return {
    getMounts: () => [],
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: unknown) => { items.set(key, value) },
    removeItem: async (key: string) => { items.delete(key) }
  }
}

describe('app password values', () => {
  it('prefixes a random 32-byte token', () => {
    const token = generateAppPassword()

    expect(token).toMatch(/^amap_[\w-]{43}$/)
    expect(generateAppPassword()).not.toBe(token)
  })

  it('hashes deterministically and compares in constant time', () => {
    const token = generateAppPassword()
    const hash = hashAppPassword(token)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(appPasswordMatchesHash(token, hash)).toBe(true)
    expect(appPasswordMatchesHash(token, hashAppPassword('amap_other'))).toBe(false)
    expect(appPasswordMatchesHash('amap_other', hash)).toBe(false)
  })
})

describe('parseBasicAuth', () => {
  it('decodes a well-formed Basic header, splitting on the first colon', () => {
    expect(parseBasicAuth(`Basic ${Buffer.from('user:pass:word').toString('base64')}`))
      .toEqual({ username: 'user', password: 'pass:word' })
    expect(parseBasicAuth(`basic ${Buffer.from('user:').toString('base64')}`))
      .toEqual({ username: 'user', password: '' })
  })

  it('round-trips with basicAuthHeader', () => {
    expect(parseBasicAuth(basicAuthHeader('owner@example.com', 'amap_secret')))
      .toEqual({ username: 'owner@example.com', password: 'amap_secret' })
  })

  it('rejects anything that is not a Basic header with a colon', () => {
    expect(parseBasicAuth(undefined)).toBeUndefined()
    expect(parseBasicAuth('Bearer abc')).toBeUndefined()
    expect(parseBasicAuth('Basic')).toBeUndefined()
    expect(parseBasicAuth('Basic !!!not-base64!!!')).toBeUndefined()
    expect(parseBasicAuth(`Basic ${Buffer.from('no-colon').toString('base64')}`)).toBeUndefined()
  })
})

describe('secretMatches', () => {
  it('accepts the configured secret only', () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true)
    expect(secretMatches('other', SECRET)).toBe(false)
    expect(secretMatches(undefined, SECRET)).toBe(false)
    expect(secretMatches('', SECRET)).toBe(false)
  })
})

describe('mailAuthHeaders', () => {
  it('builds the auth_http response for a successful imap login', () => {
    expect(mailAuthHeaders({ ok: true, protocol: 'imap', server: '10.0.0.2', user: 'bridge-user', password: 'bridge-pass' }))
      .toEqual({
        'Auth-Status': 'OK',
        'Auth-Server': '10.0.0.2',
        'Auth-Port': '1144',
        'Auth-User': 'bridge-user',
        'Auth-Pass': 'bridge-pass'
      })
  })

  it('uses the smtp port for smtp', () => {
    expect(mailAuthHeaders({ ok: true, protocol: 'smtp', server: '10.0.0.2', user: 'u', password: 'p' }))
      .toMatchObject({ 'Auth-Port': '1026' })
  })

  it('answers a generic failure with a wait', () => {
    expect(mailAuthHeaders({ ok: false })).toEqual({
      'Auth-Status': 'Invalid login or password',
      'Auth-Wait': '3'
    })
  })
})

describe('client access endpoints', () => {
  let db: Database
  let sqlite: ReturnType<typeof openSqlite>

  beforeEach(async () => {
    sqlite = openSqlite(':memory:')
    runMigrations(sqlite, await loadMigrations(readMigration))
    db = createDatabase(sqlite)

    vi.stubGlobal('useDb', () => db)
    const storage = memoryStorage()
    vi.stubGlobal('useStorage', () => storage)

    await db.insert(users).values({
      id: 'owner',
      email: OWNER_EMAIL,
      name: 'Owner',
      passwordHash: 'stored',
      createdAt: new Date()
    })
  })

  afterEach(() => {
    sqlite.close()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function storedPassword(scopes: Array<'dav' | 'mail'>, options: { revoked?: boolean } = {}) {
    const token = generateAppPassword()
    await insertAppPassword(db, {
      id: `id-${Math.random().toString(36).slice(2)}`,
      name: 'Device',
      scopes,
      tokenHash: hashAppPassword(token),
      prefix: token.slice(0, 8),
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: options.revoked ? new Date() : null
    })
    return token
  }

  function deps(overrides: Partial<ClientAccessDeps> = {}): ClientAccessDeps {
    return {
      secret: SECRET,
      authenticate: authenticateAppPassword,
      davUpstream: async () => ({ username: 'dav-user', password: 'dav-pass' }),
      mailUpstream: async () => ({ host: 'proton-bridge', user: 'bridge-user', password: 'bridge-pass' }),
      resolveHost: async () => '10.0.0.2',
      ...overrides
    }
  }

  describe('verifyAppPassword', () => {
    it('resolves a live token for the owner email and the right scope', async () => {
      const token = await storedPassword(['dav'])

      await expect(verifyAppPassword(OWNER_EMAIL, token, 'dav')).resolves.toMatchObject({ name: 'Device' })
      await expect(verifyAppPassword('OWNER@example.com', token, 'dav')).resolves.toBeDefined()
    })

    it('rejects a token used outside its scope', async () => {
      const token = await storedPassword(['dav'])

      await expect(verifyAppPassword(OWNER_EMAIL, token, 'mail')).resolves.toBeUndefined()
    })

    it('rejects a revoked token', async () => {
      const token = await storedPassword(['mail'], { revoked: true })

      await expect(verifyAppPassword(OWNER_EMAIL, token, 'mail')).resolves.toBeUndefined()
    })

    it('rejects a token once it is revoked through the repository', async () => {
      const token = await storedPassword(['dav'])
      const [row] = await db.select().from(appPasswords)

      expect(await revokeAppPassword(db, row!.id, new Date())).toBe(true)
      // Revoking twice changes nothing, and the second call reports the miss
      expect(await revokeAppPassword(db, row!.id, new Date())).toBe(false)
      await expect(verifyAppPassword(OWNER_EMAIL, token, 'dav')).resolves.toBeUndefined()
    })

    it('rejects another username and an unknown token', async () => {
      const token = await storedPassword(['dav'])

      await expect(verifyAppPassword('nobody@example.com', token, 'dav')).resolves.toBeUndefined()
      await expect(verifyAppPassword(OWNER_EMAIL, 'amap_nope', 'dav')).resolves.toBeUndefined()
    })

    it('touches last_used_at at most once per minute', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-18T10:00:00Z'))
      const token = await storedPassword(['dav'])

      const readUsedAt = async () => (await db.select().from(appPasswords))[0]!.lastUsedAt

      await verifyAppPassword(OWNER_EMAIL, token, 'dav')
      const firstUsed = await readUsedAt()

      vi.setSystemTime(new Date('2026-10-18T10:00:30Z'))
      await verifyAppPassword(OWNER_EMAIL, token, 'dav')
      expect(await readUsedAt()).toEqual(firstUsed)

      vi.setSystemTime(new Date('2026-10-18T10:01:30Z'))
      await verifyAppPassword(OWNER_EMAIL, token, 'dav')
      expect(await readUsedAt()).toEqual(new Date('2026-10-18T10:01:30Z'))
    })
  })

  describe('rate limit', () => {
    it('blocks after five failures and clears the username counter on success', async () => {
      const ip = '203.0.113.7'
      const token = await storedPassword(['dav'])

      for (let attempt = 0; attempt < 5; attempt++) {
        await expect(authenticateAppPassword({ ip, username: OWNER_EMAIL, token: 'amap_wrong', scope: 'dav' }))
          .resolves.toMatchObject({ ok: false })
      }

      const blocked = await authenticateAppPassword({ ip, username: OWNER_EMAIL, token, scope: 'dav' })
      expect(blocked.ok).toBe(false)
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
      expect((await readLoginAttempts(ip, OWNER_EMAIL)).email).toBeDefined()
    })

    it('clears the username counter on a successful login', async () => {
      const ip = '203.0.113.8'
      const token = await storedPassword(['dav'])

      await authenticateAppPassword({ ip, username: OWNER_EMAIL, token: 'amap_wrong', scope: 'dav' })
      expect((await readLoginAttempts(ip, OWNER_EMAIL)).email).toBeDefined()

      await expect(authenticateAppPassword({ ip, username: OWNER_EMAIL, token, scope: 'dav' })).resolves.toEqual({ ok: true })
      expect((await readLoginAttempts(ip, OWNER_EMAIL)).email).toBeUndefined()
    })
  })

  describe('handleDavAuth', () => {
    it('answers 204 with the upstream Basic credentials for a valid dav token', async () => {
      const token = await storedPassword(['dav'])

      const response = await handleDavAuth({
        secret: SECRET,
        authorization: basicAuthHeader(OWNER_EMAIL, token),
        ip: '203.0.113.9'
      }, deps())

      expect(response.status).toBe(204)
      expect(response.headers['X-Upstream-Authorization'])
        .toBe(basicAuthHeader('dav-user', 'dav-pass'))
    })

    it('answers 401 with a challenge for a wrong password, wrong scope or missing credentials', async () => {
      const davToken = await storedPassword(['dav'])
      const mailToken = await storedPassword(['mail'])

      const wrong = await handleDavAuth({ secret: SECRET, authorization: basicAuthHeader(OWNER_EMAIL, 'amap_wrong'), ip: '203.0.113.10' }, deps())
      expect(wrong).toEqual({ status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Allmight"' } })

      const outOfScope = await handleDavAuth({ secret: SECRET, authorization: basicAuthHeader(OWNER_EMAIL, mailToken), ip: '203.0.113.10' }, deps())
      expect(outOfScope.status).toBe(401)

      const missing = await handleDavAuth({ secret: SECRET, authorization: undefined, ip: '203.0.113.10' }, deps())
      expect(missing.status).toBe(401)

      expect(davToken).toBeDefined()
    })

    it('is a 404 without the shared secret', async () => {
      const token = await storedPassword(['dav'])

      const response = await handleDavAuth({ secret: 'wrong', authorization: basicAuthHeader(OWNER_EMAIL, token), ip: '203.0.113.11' }, deps())
      expect(response).toEqual({ status: 404, headers: {} })
    })

    it('answers 503 when no Proton account is set up', async () => {
      const token = await storedPassword(['dav'])

      const response = await handleDavAuth({
        secret: SECRET,
        authorization: basicAuthHeader(OWNER_EMAIL, token),
        ip: '203.0.113.12'
      }, deps({ davUpstream: async () => undefined }))

      expect(response.status).toBe(503)
    })
  })

  describe('handleMailAuth', () => {
    function mailInput(token: string, protocol = 'imap') {
      return {
        secret: SECRET,
        method: 'PLAIN',
        user: OWNER_EMAIL,
        pass: token,
        protocol,
        clientIp: '203.0.113.13'
      }
    }

    it('answers Auth-Status OK with the Bridge backend for imap', async () => {
      const token = await storedPassword(['mail'])

      const response = await handleMailAuth(mailInput(token, 'imap'), deps())

      expect(response.status).toBe(200)
      expect(response.headers).toEqual({
        'Auth-Status': 'OK',
        'Auth-Server': '10.0.0.2',
        'Auth-Port': '1144',
        'Auth-User': 'bridge-user',
        'Auth-Pass': 'bridge-pass'
      })
    })

    it('answers Auth-Status OK on the smtp port for smtp', async () => {
      const token = await storedPassword(['mail'])

      const response = await handleMailAuth(mailInput(token, 'smtp'), deps())
      expect(response.headers).toMatchObject({ 'Auth-Status': 'OK', 'Auth-Port': '1026' })
    })

    it('fails generically for a wrong scope, a revoked token or a bad password', async () => {
      const davToken = await storedPassword(['dav'])
      const revokedToken = await storedPassword(['mail'], { revoked: true })

      for (const token of [davToken, revokedToken, 'amap_wrong']) {
        const response = await handleMailAuth(mailInput(token), deps())
        expect(response).toEqual({ status: 200, headers: { 'Auth-Status': 'Invalid login or password', 'Auth-Wait': '3' } })
      }
    })

    it('fails generically for an unknown protocol', async () => {
      const token = await storedPassword(['mail'])

      const response = await handleMailAuth(mailInput(token, 'pop3'), deps())
      expect(response.status).toBe(200)
      expect(response.headers['Auth-Status']).toBe('Invalid login or password')
    })

    it('is a 404 without the shared secret', async () => {
      const token = await storedPassword(['mail'])

      const response = await handleMailAuth({ ...mailInput(token), secret: 'wrong' }, deps())
      expect(response).toEqual({ status: 404, headers: {} })
    })
  })
})
