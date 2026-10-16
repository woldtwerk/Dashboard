import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  tag: string
  /** `when` from the drizzle-kit journal; also the order */
  folderMillis: number
  hash: string
  statements: string[]
}

interface Journal {
  entries: { tag: string, when: number }[]
}

/** Reads drizzle-kit output (`meta/_journal.json` + `<tag>.sql`) through any reader, e.g. Nitro server assets */
export async function loadMigrations(read: (path: string) => Promise<string | null | undefined>): Promise<Migration[]> {
  const journal = await read('meta/_journal.json')
  if (!journal) {
    throw new Error('Migration journal not found')
  }

  return Promise.all((JSON.parse(journal) as Journal).entries.map(async ({ tag, when }) => {
    const sql = await read(`${tag}.sql`)
    if (!sql) {
      throw new Error(`Migration ${tag}.sql not found`)
    }

    return {
      tag,
      folderMillis: when,
      // Same hash and split as drizzle's migrator, so drizzle-kit sees the same state
      hash: createHash('sha256').update(sql).digest('hex'),
      statements: sql.split('--> statement-breakpoint').map(statement => statement.trim()).filter(Boolean)
    }
  }))
}

/**
 * Applies pending migrations, tracked in drizzle's `__drizzle_migrations` table.
 * Runs in one IMMEDIATE transaction, so concurrently starting cluster workers wait for each other
 * instead of applying the same migration twice.
 * @returns tags of the applied migrations
 */
export function runMigrations(sqlite: DatabaseSync, migrations: Migration[]): string[] {
  sqlite.exec('BEGIN IMMEDIATE')

  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`)

    const last = sqlite.prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1').get()
    const lastMillis = last ? Number(last.created_at) : -1

    const pending = migrations
      .filter(migration => migration.folderMillis > lastMillis)
      .sort((a, b) => a.folderMillis - b.folderMillis)

    for (const migration of pending) {
      for (const statement of migration.statements) {
        sqlite.exec(statement)
      }
      sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(migration.hash, migration.folderMillis)
    }

    sqlite.exec('COMMIT')

    return pending.map(migration => migration.tag)
  } catch (error) {
    sqlite.exec('ROLLBACK')
    throw error
  }
}
