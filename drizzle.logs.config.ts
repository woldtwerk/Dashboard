import { defineConfig } from 'drizzle-kit'

// Logs are a rebuildable cache in their own SQLite file, so they get their own
// schema and migration folder. The main drizzle config must not pick it up.
export default defineConfig({
  dialect: 'sqlite',
  schema: './layers/core/server/db/logs-schema.ts',
  out: './layers/core/server/db/logs-migrations'
})
