import { fileURLToPath } from 'node:url'

// Core layer: dashboard shell (layout, navigation, search, theming), services and the database.
// Domain layers register their navigation entries via `app.config.ts` → `dashboard.navigation`.
export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    '@vueuse/nuxt'
  ],

  css: [fileURLToPath(new URL('./app/assets/css/main.css', import.meta.url))],

  runtimeConfig: {
    database: {
      // NUXT_DATABASE_PATH — SQLite file, relative to the working directory
      path: '.data/allmight.sqlite'
    },
    cache: {
      // NUXT_CACHE_DIR — per-domain cache databases, rebuilt from their sources when deleted
      dir: '.data/cache'
    },
    logs: {
      // NUXT_LOGS_LEVEL — minimum level persisted and streamed: debug, info, warn or error
      level: 'info',
      // NUXT_LOGS_RETENTION_DAYS — drop log entries older than this
      retentionDays: 7,
      // NUXT_LOGS_MAX_ENTRIES — keep at most this many log entries
      maxEntries: 50000
    }
  },

  nitro: {
    // Bundle drizzle-kit migrations, so the built server can apply them on startup
    serverAssets: [{
      baseName: 'migrations',
      dir: fileURLToPath(new URL('./server/db/migrations', import.meta.url))
    }, {
      baseName: 'migrations-logs',
      dir: fileURLToPath(new URL('./server/db/logs-migrations', import.meta.url))
    }]
  }
})
