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

/**
 * The mail to open after a batch delete, Gmail-style: the first mail at or after
 * the first deleted one that is not deleted too, or the last remaining mail
 * before it. `null` when the list holds nothing else.
 */
export function nextSelectionAfter(list: MailSummary[], deletedKeys: string[]): MailSummary | null {
  const deleted = new Set(deletedKeys)
  const first = list.findIndex(mail => deleted.has(mailKey(mail)))

  if (first === -1) {
    return null
  }

  for (let index = first; index < list.length; index++) {
    const mail = list[index]!
    if (!deleted.has(mailKey(mail))) {
      return mail
    }
  }

  for (let index = first - 1; index >= 0; index--) {
    const mail = list[index]!
    if (!deleted.has(mailKey(mail))) {
      return mail
    }
  }

  return null
}

/** The list without the mail whose key is `key` */
export function removeFromList(list: MailSummary[], key: string): MailSummary[] {
  return list.filter(mail => mailKey(mail) !== key)
}
