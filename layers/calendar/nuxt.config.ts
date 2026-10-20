import { fileURLToPath } from 'node:url'
import { CALENDAR_SYNC_CRON } from './shared/sync-schedule'

// Calendar domain: provider-agnostic entities, a CalDAV provider port, API and UI.
// Connector layers (e.g. proton-dav) register a connector whose stored DAV
// credentials this layer's provider uses. Recurrence expansion and the view
// date math live in plain TypeScript under server/ and app/utils, with tests,
// and every view renders in one IANA time zone (the `tz` cookie).
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      calendar: {
        // Time zone used when the browser's is unknown, e.g. on the server
        // render before the `tz` cookie is set. Override with
        // NUXT_PUBLIC_CALENDAR_TIME_ZONE=America/New_York
        timeZone: 'Europe/Berlin'
      }
    }
  },

  nitro: {
    experimental: {
      tasks: true
    },
    // Reminders depend on the minute. The sync runs every minute too, shorter
    // than the stale window (see shared/sync-schedule.ts), so a service is
    // picked up soon after it goes stale. Both tasks take their own lock, so
    // only one cluster worker sends reminders and one syncs a calendar.
    scheduledTasks: {
      [CALENDAR_SYNC_CRON]: ['calendar:reminders', 'calendar:sync']
    },
    // Bundle the cache migrations, so the calendar cache database can apply them
    serverAssets: [{
      baseName: 'migrations-calendar',
      dir: fileURLToPath(new URL('./server/db/cache-migrations', import.meta.url))
    }]
  }
})
