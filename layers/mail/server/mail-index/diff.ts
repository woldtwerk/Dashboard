import type { MailMessageState } from '../../shared/types/mail'

export interface MailboxDiff {
  /** Newest first, so recent mail becomes searchable first */
  added: number[]
  changed: MailMessageState[]
  removed: number[]
}

/** What changed in a mailbox since the last sync */
export function diffMailboxState(indexed: Map<number, Omit<MailMessageState, 'uid'>>, current: MailMessageState[]): MailboxDiff {
  const seen = new Set<number>()
  const added: number[] = []
  const changed: MailMessageState[] = []

  for (const message of current) {
    seen.add(message.uid)
    const known = indexed.get(message.uid)
    if (!known) {
      added.push(message.uid)
    } else if (known.unread !== message.unread || known.flagged !== message.flagged) {
      changed.push(message)
    }
  }

  return {
    added: added.sort((a, b) => b - a),
    changed,
    removed: [...indexed.keys()].filter(uid => !seen.has(uid))
  }
}
