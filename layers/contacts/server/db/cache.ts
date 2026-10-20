import { contactsAddressBooks, contactsCards, contactsSync } from './cache-schema'

/** The cache tables as one drizzle schema, shared by every caller of `useCacheDb` */
export const contactsCacheSchema = { contactsAddressBooks, contactsCards, contactsSync }
