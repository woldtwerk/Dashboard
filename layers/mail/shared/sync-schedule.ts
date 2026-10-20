/** How long indexed mail stays fresh; the background sync runs once it is older */
export const MAIL_SYNC_STALE_MS = 2 * 60_000

/**
 * Schedule of the background sync: every minute, shorter than the stale window,
 * so a service is picked up at most about a minute after it goes stale. Running
 * the task less often than the window lets a service that is still fresh at one
 * run wait for the next, stretching the effective interval. The stale check is
 * only a lock and a database lookup, so the extra runs are cheap.
 */
export const MAIL_SYNC_CRON = '* * * * *'
