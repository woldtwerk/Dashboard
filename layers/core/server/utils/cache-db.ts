import { useRuntimeConfig } from 'nuxt/server'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { createDatabase, enableWal, openSqlite, retryWhileBusy } from '../db/client'
import { loadMigrations, runMigrations } from '../db/migrate'
import { cacheDbPath } from './cache-path'

// One connection per worker process and domain; SQLite coordinates the workers through the file
const connections = new Map<string, Promise<unknown>>()

async function migrate(domain: string, sqlite: ReturnType<typeof openSqlite>) {
  // Migrations are bundled as server assets, one asset base per domain
  const assets = useStorage(`assets:migrations-${domain}`)
  const migrations = await loadMigrations(async (path) => {
    const value = await assets.getItem(path.replaceAll('/', ':'))
    // JSON assets come back parsed
    return value && typeof value === 'object' ? JSON.stringify(value) : value as string | null
  })

  const applied = await retryWhileBusy(() => runMigrations(sqlite, migrations))
  if (applied.length) {
    console.info(`[cache:${domain}] Applied migrations: ${applied.join(', ')}`)
  }
}

async function connect<TSchema extends Record<string, unknown>>(domain: string, schema: TSchema): Promise<SqliteRemoteDatabase<TSchema>> {
  const sqlite = openSqlite(cacheDbPath(useRuntimeConfig().cache.dir, domain))

  try {
    await enableWal(sqlite)
    await migrate(domain, sqlite)
  } catch (error) {
    sqlite.close()
    throw error
  }

  return createDatabase(sqlite, schema)
}

/**
 * Drizzle database of one domain's cache file. Cache data is rebuildable, so each
 * domain gets its own file: a long sync never blocks another domain's writes.
 */
export function useCacheDb<TSchema extends Record<string, unknown>>(domain: string, schema: TSchema): Promise<SqliteRemoteDatabase<TSchema>> {
  const existing = connections.get(domain)
  if (existing) {
    return existing as Promise<SqliteRemoteDatabase<TSchema>>
  }

  const connection = connect(domain, schema).catch((error) => {
    connections.delete(domain)
    throw error
  })
  connections.set(domain, connection)

  return connection
}
