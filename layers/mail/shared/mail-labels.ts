/** Proton files user labels under `Labels/`; their mail also lives in a real folder */
export const LABEL_MAILBOX_PREFIX = 'Labels/'

/** Longest label name Proton accepts; a label is one IMAP folder segment */
export const LABEL_NAME_MAX = 200

/** The IMAP folder a label is filed under */
export function labelMailbox(label: string): string {
  return `${LABEL_MAILBOX_PREFIX}${label}`
}

/** The label name of a label folder; undefined for a real folder */
export function labelFromMailbox(path: string): string | undefined {
  if (!path.startsWith(LABEL_MAILBOX_PREFIX)) {
    return undefined
  }

  const label = path.slice(LABEL_MAILBOX_PREFIX.length)
  return label || undefined
}

/**
 * Whether a value can name a label: one non-empty folder segment, short enough
 * for IMAP, and without the traversal segments a path could smuggle in.
 */
export function isValidLabelName(label: string): boolean {
  const name = label.trim()
  return name.length > 0 && name.length <= LABEL_NAME_MAX && !name.includes('/') && !name.includes('..')
}
