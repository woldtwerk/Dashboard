import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, openSqlite } from '../server/db/client'
import type { Database } from '../server/db/client'
import { loadMigrations, runMigrations } from '../server/db/migrate'
import { findMcpTokenByHash, insertMcpToken } from '../server/db/mcp-token-repository'
import { authenticateMcpToken } from '../server/utils/mcp-auth'
import { isAllowedMcpOrigin, requestOrigin } from '../server/utils/mcp-origin'
import { generateMcpToken, hashMcpToken, mcpTokenMatchesHash, parseBearerToken } from '../server/utils/mcp-tokens'

const migrationsDir = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const readMigration = (path: string) => readFile(migrationsDir + path, 'utf8').catch(() => null)

describe('mcp token values', () => {
  it('prefixes a random 32-byte token', () => {
    const token = generateMcpToken()

    expect(token).toMatch(/^amcp_[\w-]{43}$/)
    expect(generateMcpToken()).not.toBe(token)
  })

  it('hashes deterministically and compares in constant time', () => {
    const token = generateMcpToken()
    const hash = hashMcpToken(token)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(mcpTokenMatchesHash(token, hash)).toBe(true)
    expect(mcpTokenMatchesHash(token, hashMcpToken('amcp_other'))).toBe(false)
    expect(mcpTokenMatchesHash('amcp_other', hash)).toBe(false)
  })

  it('parses only a well-formed Bearer header', () => {
    expect(parseBearerToken('Bearer amcp_abc')).toBe('amcp_abc')
    expect(parseBearerToken('bearer amcp_abc')).toBe('amcp_abc')
    expect(parseBearerToken('Basic amcp_abc')).toBeUndefined()
    expect(parseBearerToken('Bearer')).toBeUndefined()
    expect(parseBearerToken(undefined)).toBeUndefined()
  })
})

describe('mcp origin guard', () => {
  it('builds the origin from host and forwarded protocol', () => {
    expect(requestOrigin('dash.example', 'https', false)).toBe('https://dash.example')
    expect(requestOrigin('dash.example', 'https, http', false)).toBe('https://dash.example')
    expect(requestOrigin('localhost:3000', undefined, false)).toBe('http://localhost:3000')
    expect(requestOrigin(undefined, 'https')).toBeUndefined()
  })

  it('allows a missing origin and the app own origin only', () => {
    expect(isAllowedMcpOrigin(undefined, 'https://dash.example')).toBe(true)
    expect(isAllowedMcpOrigin('https://dash.example', 'https://dash.example')).toBe(true)
    expect(isAllowedMcpOrigin('https://evil.example', 'https://dash.example')).toBe(false)
    expect(isAllowedMcpOrigin('not a url', 'https://dash.example')).toBe(false)
  })
})

describe('authenticateMcpToken', () => {
  let db: Database

  beforeEach(async () => {
    const sqlite = openSqlite(':memory:')
    runMigrations(sqlite, await loadMigrations(readMigration))
    db = createDatabase(sqlite)
    vi.stubGlobal('useDb', () => db)
  })

  async function storedToken(scope: 'read' | 'write' = 'read') {
    const token = generateMcpToken()
    await insertMcpToken(db, {
      id: `id-${Math.random().toString(36).slice(2)}`,
      name: 'Claude',
      tokenHash: hashMcpToken(token),
      scope,
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: null
    })
    return token
  }

  it('resolves a live token and records its use', async () => {
    const token = await storedToken('write')

    await expect(authenticateMcpToken(`Bearer ${token}`)).resolves.toMatchObject({ name: 'Claude', scope: 'write' })
    expect(await findMcpTokenByHash(db, hashMcpToken(token))).toMatchObject({ lastUsedAt: expect.any(Date) })
  })

  it('rejects unknown, malformed and revoked tokens', async () => {
    expect(await authenticateMcpToken(undefined)).toBeUndefined()
    expect(await authenticateMcpToken('Bearer amcp_nope')).toBeUndefined()

    const token = generateMcpToken()
    await insertMcpToken(db, {
      id: 'revoked',
      name: 'Old',
      tokenHash: hashMcpToken(token),
      scope: 'read',
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: new Date()
    })
    expect(await authenticateMcpToken(`Bearer ${token}`)).toBeUndefined()
  })

  it('does not touch last_used_at again within a minute', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-18T10:00:00Z'))
    const token = await storedToken()

    await authenticateMcpToken(`Bearer ${token}`)
    const first = (await findMcpTokenByHash(db, hashMcpToken(token)))!.lastUsedAt

    vi.setSystemTime(new Date('2026-10-18T10:00:30Z'))
    await authenticateMcpToken(`Bearer ${token}`)
    const second = (await findMcpTokenByHash(db, hashMcpToken(token)))!.lastUsedAt
    expect(second).toEqual(first)

    vi.setSystemTime(new Date('2026-10-18T10:01:30Z'))
    await authenticateMcpToken(`Bearer ${token}`)
    const third = (await findMcpTokenByHash(db, hashMcpToken(token)))!.lastUsedAt
    expect(third).toEqual(new Date('2026-10-18T10:01:30Z'))
    vi.useRealTimers()
  })
})
