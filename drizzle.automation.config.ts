import { defineConfig } from 'drizzle-kit'

// Automation runs are a rebuildable cache in their own SQLite file (the `automation`
// domain), so they get their own schema and migration folder. The main drizzle
// config must not pick it up.
export default defineConfig({
  dialect: 'sqlite',
  schema: './layers/automation/server/db/cache-schema.ts',
  out: './layers/automation/server/db/cache-migrations'
})
