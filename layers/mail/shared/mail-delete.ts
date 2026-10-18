import type { Mailbox } from './types/mail'

/** The fallback path used when a provider reports no `\Trash` special-use flag */
const TRASH_PATH = 'Trash'

/**
 * The mailbox a delete moves a mail to. The folder marked `\Trash` wins; some
 * providers leave the flag empty, so a folder literally called `Trash` is the
 * fallback. `undefined` means there is nowhere to move it — either the current
 * mailbox already is the trash (the delete is permanent) or the account has no
 * trash at all (also permanent).
 */
export function trashTarget(mailboxes: Mailbox[], current: string): Mailbox | undefined {
  const trash = mailboxes.find(mailbox => mailbox.specialUse === '\\Trash')
    ?? mailboxes.find(mailbox => mailbox.path === TRASH_PATH)

  if (!trash || trash.path === current) {
    return undefined
  }

  return trash
}
