import { PERSISTED_LIST_MAX_AGE, PERSISTED_MESSAGE_MAX_AGE } from '#layers/core/app/utils/query-cache-persistence'

// The body's flags still go stale in the default 30 s; only the cache lifetime is longer.
export const MAIL_MESSAGE_GC_TIME = PERSISTED_MESSAGE_MAX_AGE
/** Lists, folders and conversations survive a day so a reload opens with last visit's data. */
export const MAIL_QUERY_GC_TIME = PERSISTED_LIST_MAX_AGE
