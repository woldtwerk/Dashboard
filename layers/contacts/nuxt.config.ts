import { fileURLToPath } from 'node:url'
import { CONTACTS_SYNC_CRON } from './shared/sync-schedule'

// Contacts domain: provider-agnostic entities, a CardDAV provider port, API and UI.
// Connector layers (e.g. proton-dav) register a connector whose stored DAV
// credentials this layer's provider uses. vCard parsing, A–Z grouping and
// search matching live in plain TypeScript with tests.
export default defineNuxtConfig({
  nitro: {
    experimental: {
      tasks: true
    },
    // The sync runs every minute, shorter than the stale window (see
    // shared/sync-schedule.ts), so a service is picked up soon after it goes
    // stale. The task takes its own lock, so only one cluster worker syncs a
    // contacts service.
    scheduledTasks: {
      [CONTACTS_SYNC_CRON]: ['contacts:sync']
    },
    // Bundle the cache migrations, so the contacts cache database can apply them
    serverAssets: [{
      baseName: 'migrations-contacts',
      dir: fileURLToPath(new URL('./server/db/cache-migrations', import.meta.url))
    }]
  }
})
