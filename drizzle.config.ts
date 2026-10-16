import { defineConfig } from 'drizzle-kit'

// Tables live in the layers that own them; migrations are bundled and applied at startup by the core layer
export default defineConfig({
  dialect: 'sqlite',
  schema: './layers/*/server/db/schema.ts',
  out: './layers/core/server/db/migrations'
})
