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
    }
  },

  nitro: {
    // Bundle drizzle-kit migrations, so the built server can apply them on startup
    serverAssets: [{
      baseName: 'migrations',
      dir: fileURLToPath(new URL('./server/db/migrations', import.meta.url))
    }]
  }
})
