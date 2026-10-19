import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, openSqlite } from '#layers/core/server/db/client'
import * as cacheSchema from '../server/db/cache-schema'
import { countRunsAwaitingReview } from '../server/utils/runs'

// The count only reads `outcome`, so the test table carries just that column and
// the id; the real table is created by the layer's migrations.
let sqlite: ReturnType<typeof openSqlite>

beforeEach(() => {
  sqlite = openSqlite(':memory:')
  sqlite.exec('CREATE TABLE automation_runs (id TEXT PRIMARY KEY, outcome TEXT NOT NULL)')
  vi.stubGlobal('useCacheDb', () => createDatabase(sqlite, cacheSchema))
})

afterEach(() => {
  sqlite.close()
  vi.unstubAllGlobals()
})

function insert(id: string, outcome: string) {
  sqlite.exec(`INSERT INTO automation_runs (id, outcome) VALUES ('${id}', '${outcome}')`)
}

describe('countRunsAwaitingReview', () => {
  it('counts the runs paused for an answer and nothing else', async () => {
    insert('a', 'review')
    insert('b', 'suggested')
    insert('c', 'review')
    insert('d', 'applied')

    await expect(countRunsAwaitingReview()).resolves.toBe(2)
  })

  it('is zero without a paused run', async () => {
    insert('a', 'applied')

    await expect(countRunsAwaitingReview()).resolves.toBe(0)
  })
})
