/** How often the background crawl into the drive cache runs. */
export const DRIVE_SYNC_CRON = '*/5 * * * *'

/**
 * How long one crawl run keeps picking up new folders. Shorter than the cron
 * interval, so a run that used its budget still leaves the container lock free
 * before the next one starts.
 */
export const DRIVE_CRAWL_BUDGET_MS = 4 * 60_000

/**
 * Gap between two `filesystem list` calls. Every CLI call runs under one lock in
 * the container and a user's read gives up after 15 s, so the crawl yields the
 * lock between folders instead of keeping it busy for its whole run.
 */
export const DRIVE_CRAWL_PAUSE_MS = 1_000

/**
 * How long a folder listing stays fresh for the crawl; an older one is listed
 * again. Every folder is visited about this often while runs continue.
 */
export const DRIVE_CRAWL_REFRESH_MS = 6 * 60 * 60_000
