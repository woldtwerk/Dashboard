import { driveEntries, driveFolders, driveSync } from './cache-schema'

/** The cache tables as one drizzle schema, shared by every caller of `useCacheDb` */
export const driveCacheSchema = { driveEntries, driveFolders, driveSync }
