import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import * as schema from './schema'

export type Database = ReturnType<typeof createDatabase>

/** Opens the SQLite file; call `enableWal()` when it's shared between cluster workers */
export function openSqlite(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }

  const sqlite = new DatabaseSync(path)
  sqlite.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')

  return sqlite
}

const isBusy = (error: unknown) => /SQLITE_BUSY|database is locked/i.test(String((error as { errstr?: string })?.errstr ?? error))

/**
 * Retries while another worker holds the lock. SQLite reports some lock conflicts
 * (e.g. switching to WAL) right away instead of waiting for busy_timeout.
 */
export async function retryWhileBusy<T>(fn: () => T, attempts = 20): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return fn()
    } catch (error) {
      if (!isBusy(error) || attempt >= attempts) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 25 * attempt))
    }
  }
}

/** WAL lets cluster workers read while one writes */
export function enableWal(sqlite: DatabaseSync): Promise<void> {
  return retryWhileBusy(() => {
    sqlite.exec('PRAGMA journal_mode = WAL')
  })
}

/** Drizzle on top of node:sqlite through the sqlite-proxy driver */
export function createDatabase(sqlite: DatabaseSync) {
  return drizzle(async (query, params, method) => {
    const statement = sqlite.prepare(query)
    const args = params as SQLInputValue[]

    if (method === 'run') {
      statement.run(...args)
      return { rows: [] }
    }

    // The proxy driver maps positional rows onto the schema
    statement.setReturnArrays(true)

    if (method === 'get') {
      return { rows: statement.get(...args) as unknown as unknown[] }
    }

    return { rows: statement.all(...args) as unknown as unknown[][] }
  }, { schema })
}
