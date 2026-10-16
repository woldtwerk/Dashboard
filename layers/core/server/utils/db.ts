import type { DatabaseSync } from 'node:sqlite'
import { useRuntimeConfig } from 'nuxt/server'
import { createDatabase, enableWal, openSqlite, retryWhileBusy } from '../db/client'
import type { Database } from '../db/client'
import { loadMigrations, runMigrations } from '../db/migrate'

// One connection per worker process; SQLite coordinates the workers through the file
let ready: Promise<Database> | undefined

async function connect(): Promise<Database> {
  const sqlite = openSqlite(useRuntimeConfig().database.path)

  try {
    await enableWal(sqlite)
    await migrate(sqlite)
  } catch (error) {
    sqlite.close()
    throw error
  }

  return createDatabase(sqlite)
}

async function migrate(sqlite: DatabaseSync) {
  // Migrations are bundled as server assets (see the core nuxt.config)
  const assets = useStorage('assets:migrations')
  const migrations = await loadMigrations(async (path) => {
    const value = await assets.getItem(path.replaceAll('/', ':'))
    // JSON assets come back parsed
    return value && typeof value === 'object' ? JSON.stringify(value) : value as string | null
  })

  const applied = await retryWhileBusy(() => runMigrations(sqlite, migrations))
  if (applied.length) {
    console.info(`[database] Applied migrations: ${applied.join(', ')}`)
  }
}

/** Drizzle database; opens the SQLite file and applies pending migrations on first use */
export function useDb(): Promise<Database> {
  ready ??= connect().catch((error) => {
    ready = undefined
    throw error
  })
  return ready
}
