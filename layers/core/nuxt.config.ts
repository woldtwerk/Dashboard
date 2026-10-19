import { fileURLToPath } from 'node:url'

// Core layer: dashboard shell (layout, navigation, search, theming), services and the database.
// Domain layers register their navigation entries via `app.config.ts` → `dashboard.navigation`.
export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    '@vueuse/nuxt',
    'nuxt-auth-utils'
  ],

  css: [fileURLToPath(new URL('./app/assets/css/main.css', import.meta.url))],

  runtimeConfig: {
    // Sealed session cookie; its password comes from NUXT_SESSION_PASSWORD.
    // maxAge/httpOnly/sameSite are what the login expects, the module already
    // defaults to httpOnly + secure + sameSite=lax.
    session: {
      maxAge: 60 * 60 * 24 * 30,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: true
      }
    },
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
    },
    vapid: {
      // NUXT_VAPID_PUBLIC_KEY — base64url public key, also handed to the browser in `public.vapidPublicKey`
      publicKey: '',
      // NUXT_VAPID_PRIVATE_KEY — base64url private key, only used by the server to sign pushes
      privateKey: '',
      // NUXT_VAPID_SUBJECT — `mailto:` or `https:` contact for the push service
      subject: ''
    },
    public: {
      // The env var is not a NUXT_PUBLIC_* name, so the public copy is filled here
      vapidPublicKey: process.env.NUXT_VAPID_PUBLIC_KEY ?? '',
      // NUXT_PUBLIC_TIME_ZONE — IANA zone times render in when the browser's is
      // unknown, e.g. on the server render before the `tz` cookie is set.
      // Override with NUXT_PUBLIC_TIME_ZONE=America/New_York
      timeZone: 'Europe/Berlin'
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
