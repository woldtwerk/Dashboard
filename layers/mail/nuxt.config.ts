import { MAIL_SYNC_CRON } from './shared/sync-schedule'

// Mail domain layer: provider-agnostic entities, API and UI.
// Connector layers (e.g. mail-proton) register a connector plus a provider via `registerMailProvider()`.
export default defineNuxtConfig({
  nitro: {
    experimental: {
      tasks: true
    },
    // Mail counts as stale after MAIL_SYNC_STALE_MS; the task runs every minute,
    // shorter than that window (see shared/sync-schedule.ts), so a service is
    // picked up soon after it goes stale. The task takes a per-service lock, so
    // only one cluster worker syncs an account.
    scheduledTasks: {
      [MAIL_SYNC_CRON]: ['mail:sync']
    }
  }
})
