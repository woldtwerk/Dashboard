import { defineConfig } from 'drizzle-kit'

// Per-domain cache: rebuildable data, so it lives in its own SQLite file and
// migration folder. The main drizzle config must not pick this schema up.
export default defineConfig({
  dialect: 'sqlite',
  schema: './layers/contacts/server/db/cache-schema.ts',
  out: './layers/contacts/server/db/cache-migrations'
})
