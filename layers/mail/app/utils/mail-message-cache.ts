import type { MailMessage } from '#layers/mail/shared/types/mail'

/** How many message bodies one app keeps; the oldest goes first */
export const MAIL_MESSAGE_CACHE_SIZE = 50

/** In-flight and resolved message requests, in insertion order (oldest first) */
export type MailMessageRequests = Map<string, Promise<MailMessage>>

/** A message across accounts and folders; uids repeat, so service and mailbox are part of it */
export function mailMessageCacheKey(service: string, mailbox: string, uid: number): string {
  return `${service}:${mailbox}:${uid}`
}

/**
 * Remember a message request and drop the oldest ones beyond `limit`, so a long
 * session does not keep every body it has read. Re-remembering a key moves it to
 * the newest end. Returns the request, so callers can chain on it.
 */
export function rememberMailMessage(
  cache: MailMessageRequests,
  key: string,
  request: Promise<MailMessage>,
  limit = MAIL_MESSAGE_CACHE_SIZE
): Promise<MailMessage> {
  cache.delete(key)
  cache.set(key, request)

  while (cache.size > limit) {
    const oldest = cache.keys().next()
    if (oldest.done) {
      break
    }
    cache.delete(oldest.value)
  }

  return request
}
