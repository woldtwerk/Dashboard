import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, openSqlite } from '#layers/core/server/db/client'
import * as cacheSchema from '../server/db/cache-schema'
import { activationWatermark, ensureMailActivation } from '../server/utils/automation-activation'
import { isMailAfter } from '../server/utils/automation-items'
import { ensureActivation, readActivation, setActivation } from '../server/utils/runs'

// The table comes from the real generated migration, never from a hand-written one
const migrationsDir = fileURLToPath(new URL('../server/db/cache-migrations/', import.meta.url))
const activationMigration = readdirSync(migrationsDir).find(file => /^0001_.*\.sql$/.test(file))!
const statements = readFileSync(join(migrationsDir, activationMigration), 'utf8')
  .split('--> statement-breakpoint')
  .map(statement => statement.trim())
  .filter(Boolean)

let sqlite: ReturnType<typeof openSqlite>

beforeEach(() => {
  sqlite = openSqlite(':memory:')
  for (const statement of statements) {
    sqlite.exec(statement)
  }
  vi.stubGlobal('useCacheDb', () => createDatabase(sqlite, cacheSchema))
})

afterEach(() => {
  sqlite.close()
  vi.unstubAllGlobals()
})

describe('activationWatermark', () => {
  it('floors to the whole second and one back, so mail of the activation second is still new', () => {
    const watermark = activationWatermark(new Date('2026-10-18T09:00:00.500Z'))

    expect(watermark).toBe('2026-10-18T08:59:59.000Z')
    expect(isMailAfter('2026-10-18T09:00:00.000Z', watermark)).toBe(true)
  })
})

describe('ensureMailActivation', () => {
  it('starts with the lookback on the first call and keeps the stored watermark afterwards', async () => {
    const first = await ensureMailActivation('mail-1', new Date('2026-10-18T09:00:00.000Z'))
    expect(first).toBe('2026-10-18T08:49:59.000Z')

    const second = await ensureMailActivation('mail-1', new Date('2026-10-18T12:00:00.000Z'))
    expect(second).toBe(first)
  })
})

describe('ensureActivation', () => {
  it('is insert-only: a later activation keeps the first one', async () => {
    await ensureActivation('mail', 'mail-1', '2026-10-18T09:00:00.000Z')
    await ensureActivation('mail', 'mail-1', '2026-10-18T10:00:00.000Z')

    await expect(readActivation('mail', 'mail-1')).resolves.toBe('2026-10-18T09:00:00.000Z')
  })
})

describe('setActivation', () => {
  it('overwrites an existing activation, so a re-enabled workflow starts now', async () => {
    await ensureActivation('mail', 'mail-1', '2026-10-18T09:00:00.000Z')
    await setActivation('mail', 'mail-1', '2026-10-18T10:00:00.000Z')

    await expect(readActivation('mail', 'mail-1')).resolves.toBe('2026-10-18T10:00:00.000Z')
  })
})
