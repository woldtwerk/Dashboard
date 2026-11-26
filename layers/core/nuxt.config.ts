import { fileURLToPath } from 'node:url'

// The injectManifest strategy points the module at the source directory, not a
// file, so it must be absolute.
const serviceWorkerSrcDir = fileURLToPath(new URL('./app/sw', import.meta.url))

// Core layer: dashboard shell (layout, navigation, search, theming), services and the database.
// Domain layers register their navigation entries via `app.config.ts` → `dashboard.navigation`.
export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    '@vueuse/nuxt',
    'nuxt-auth-utils',
    '@vite-pwa/nuxt',
    '@pinia/nuxt',
    '@pinia/colada-nuxt'
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

  routeRules: {
    '/sw.js': { headers: { 'Cache-Control': 'no-cache' } },
    '/manifest.webmanifest': { headers: { 'Cache-Control': 'no-cache' } }
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
  },

  pwa: {
    strategies: 'injectManifest',
    srcDir: serviceWorkerSrcDir,
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    injectRegister: 'auto',
    injectManifest: {
      globPatterns: [
        '_nuxt/**/*.{js,css,woff2}',
        'pwa-*.png',
        'apple-touch-icon-180x180.png',
        'offline.html'
      ],
      // The module rewrites every *.html entry to a route URL for generated
      // sites. This app is server-rendered and needs the real offline file.
      manifestTransforms: [async (entries: Array<{ url: string, revision: string | null }>) => ({ manifest: entries, warnings: [] })]
    },
    manifest: {
      name: 'Allmight',
      short_name: 'Allmight',
      description: 'One dashboard for mail, drive, calendar and more.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#1b1718',
      background_color: '#1b1718',
      icons: [
        { src: '/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    devOptions: {
      enabled: false
    }
  }
})
