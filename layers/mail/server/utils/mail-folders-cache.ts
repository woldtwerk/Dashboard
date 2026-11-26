// Folder counts change with the user's own writes and with the mail events, so
// those mark the cached list stale; the next read answers from it while revalidating.

import { invalidateSwr } from '../../../core/server/utils/swr-cache'

/** Folder lists are fresh for 30 s and kept in the store for a day. */
export const MAIL_FOLDERS_SWR = { freshMs: 30_000, storeTtlSeconds: 24 * 60 * 60, lockTtlMs: 60_000 } as const

export function mailFoldersKey(serviceId: string): string {
  return `mail:folders:${serviceId}`
}

/** Marks the service's cached folder list stale; the next read answers from it while it revalidates. */
export async function invalidateMailFolders(serviceId: string): Promise<void> {
  await invalidateSwr(mailFoldersKey(serviceId), MAIL_FOLDERS_SWR.storeTtlSeconds)
}
