import type { MailSummary } from '#layers/mail/shared/types/mail'

/**
 * One selected mail. A UID is only unique within its mailbox (and the page's
 * account is in the URL), so the key is `<mailbox>:<uid>`.
 */
export type MailSelectionKey = string

/** A selection is capped, so a shared link cannot grow without bound */
export const MAIL_SELECTION_MAX = 200

/** The key the list, the URL and the context menu use for a mail */
export function mailSelectionKey(mail: Pick<MailSummary, 'mailbox' | 'uid'>): MailSelectionKey {
  return `${mail.mailbox}:${mail.uid}`
}

/** Whether a key is part of the selection, for the row's selected style */
export function isMailSelected(selection: MailSelectionKey[], mail: Pick<MailSummary, 'mailbox' | 'uid'>): boolean {
  return selection.includes(mailSelectionKey(mail))
}

/** Ctrl/⌘-click: add the mail to the selection, or remove it if it is already in */
export function toggleSelection(selection: MailSelectionKey[], key: MailSelectionKey): MailSelectionKey[] {
  return selection.includes(key)
    ? selection.filter(candidate => candidate !== key)
    : [...selection, key]
}

/**
 * Shift-click: every mail between the anchor and the target, in the list's own
 * order. Without a usable anchor the target alone is selected.
 */
export function rangeSelection(
  keys: MailSelectionKey[],
  anchor: MailSelectionKey | undefined,
  target: MailSelectionKey
): MailSelectionKey[] {
  const start = anchor ? keys.indexOf(anchor) : -1
  const end = keys.indexOf(target)
  if (start < 0 || end < 0) {
    return [target]
  }

  const [from, to] = start <= end ? [start, end] : [end, start]
  return keys.slice(from, to + 1)
}

/** Split an internal `<mailbox>:<uid>` key at its last colon; a mailbox may contain colons */
function splitKey(key: MailSelectionKey): { mailbox: string, uid: string } | undefined {
  const at = key.lastIndexOf(':')
  if (at < 0) {
    return undefined
  }
  return { mailbox: key.slice(0, at), uid: key.slice(at + 1) }
}

/**
 * The URL form `?sel=<mailbox>:<uid>,<uid>;<mailbox>:<uid>`: grouped per mailbox,
 * mailbox names URI-encoded so a separator inside one survives. `null` means the
 * key is removed from the query.
 */
export function selectionToQuery(selection: MailSelectionKey[]): string | null {
  const capped = selection.slice(0, MAIL_SELECTION_MAX)
  if (!capped.length) {
    return null
  }

  const groups = new Map<string, string[]>()
  for (const key of capped) {
    const parts = splitKey(key)
    if (!parts || !Number.isInteger(Number(parts.uid)) || Number(parts.uid) <= 0) {
      continue
    }
    const uids = groups.get(parts.mailbox)
    if (uids) {
      uids.push(parts.uid)
    } else {
      groups.set(parts.mailbox, [parts.uid])
    }
  }

  const value = [...groups]
    .map(([mailbox, uids]) => `${encodeURIComponent(mailbox)}:${uids.join(',')}`)
    .join(';')

  return value || null
}

/** The selection from the URL; malformed groups are dropped and the cap applies */
export function selectionFromQuery(query: { sel?: unknown }): MailSelectionKey[] {
  const values = Array.isArray(query.sel)
    ? query.sel.filter((value): value is string => typeof value === 'string')
    : typeof query.sel === 'string' ? [query.sel] : []
  const selection: MailSelectionKey[] = []
  const seen = new Set<MailSelectionKey>()

  for (const value of values) {
    for (const group of value.split(';')) {
      const at = group.indexOf(':')
      if (at <= 0) {
        continue
      }

      let mailbox: string
      try {
        mailbox = decodeURIComponent(group.slice(0, at))
      } catch {
        continue
      }
      if (!mailbox) {
        continue
      }

      for (const part of group.slice(at + 1).split(',')) {
        const uid = Number(part)
        if (!Number.isInteger(uid) || uid <= 0) {
          continue
        }
        const key = `${mailbox}:${uid}`
        if (!seen.has(key)) {
          seen.add(key)
          selection.push(key)
        }
        if (selection.length >= MAIL_SELECTION_MAX) {
          return selection
        }
      }
    }
  }

  return selection
}

/**
 * The URL form of a conversation selection: the keys are comma separated and
 * URI-encoded, so a key holding a separator of its own survives. `null` means
 * the key is removed from the query.
 */
export function conversationSelectionToQuery(selection: MailSelectionKey[]): string | null {
  const capped = selection.slice(0, MAIL_SELECTION_MAX)
  if (!capped.length) {
    return null
  }

  return capped.map(key => encodeURIComponent(key)).join(',')
}

/** The conversation selection from the URL; malformed parts are dropped and the cap applies */
export function conversationSelectionFromQuery(query: { sel?: unknown }): MailSelectionKey[] {
  const values = Array.isArray(query.sel)
    ? query.sel.filter((value): value is string => typeof value === 'string')
    : typeof query.sel === 'string' ? [query.sel] : []
  const selection: MailSelectionKey[] = []
  const seen = new Set<MailSelectionKey>()

  for (const value of values) {
    for (const part of value.split(',')) {
      if (!part) {
        continue
      }

      let key: string
      try {
        key = decodeURIComponent(part)
      } catch {
        continue
      }
      if (!key || seen.has(key)) {
        continue
      }

      seen.add(key)
      selection.push(key)
      if (selection.length >= MAIL_SELECTION_MAX) {
        return selection
      }
    }
  }

  return selection
}

/**
 * What a context menu acts on: the whole selection when the right-clicked mail is
 * part of it, otherwise just that mail.
 */
export function contextTargets(
  selection: MailSelectionKey[],
  clicked: MailSelectionKey
): MailSelectionKey[] {
  return selection.includes(clicked) ? [...selection] : [clicked]
}
