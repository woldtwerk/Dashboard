import { calendarCollections, calendarObjects, calendarSync } from './cache-schema'

/** The cache tables as one drizzle schema, shared by every caller of `useCacheDb` */
export const calendarCacheSchema = { calendarCollections, calendarObjects, calendarSync }
