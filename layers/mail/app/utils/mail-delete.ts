import type { MailSummary } from '#layers/mail/shared/types/mail'
import { mailKey } from './mail'

/**
 * The mail to open after the one at `deletedKey` is deleted, Gmail-style: the
 * next mail in the list, or the previous one when it was last, or null when the
 * list holds nothing else.
 */
export function nextSelection(list: MailSummary[], deletedKey: string): MailSummary | null {
  const index = list.findIndex(mail => mailKey(mail) === deletedKey)

  if (index === -1) {
    return null
  }

  return list[index + 1] ?? list[index - 1] ?? null
}

/** The list without the mail whose key is `key` */
export function removeFromList(list: MailSummary[], key: string): MailSummary[] {
  return list.filter(mail => mailKey(mail) !== key)
}
