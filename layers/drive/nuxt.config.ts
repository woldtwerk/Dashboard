import { fileURLToPath } from 'node:url'
import { DRIVE_SYNC_CRON } from './shared/sync-schedule'

// Drive domain layer: provider-agnostic entities, API and UI.
// Connector layers (e.g. drive-proton) register a connector plus a provider via `registerDriveProvider()`.
export default defineNuxtConfig({
  nitro: {
    experimental: {
      tasks: true
    },
    // The crawl walks the whole tree in budgeted runs. Every cluster worker
    // runs the task, but one global crawl lock makes a single worker walk the
    // tree; the pause between folders leaves the CLI lock to a user's click.
    // The budget is shared by every service of a run, and the schedule is
    // shorter than the crawl budget plus pause.
    scheduledTasks: {
      [DRIVE_SYNC_CRON]: ['drive:sync']
    },
    // Bundle the cache migrations, so the drive cache database can apply them
    serverAssets: [{
      baseName: 'migrations-drive',
      dir: fileURLToPath(new URL('./server/db/cache-migrations', import.meta.url))
    }]
  }
})
