/** Bump when the indexed document shape changes, so existing indexes are rebuilt once */
export const MAIL_INDEX_SCHEMA_VERSION = 3

export interface StoredMailboxIndexState {
  uidValidity: string
  schemaVersion: number
}

/**
 * Whether a stored mailbox still matches the server and the current document shape.
 * A changed UIDVALIDITY renumbers the mailbox; an older schema version predates a document
 * field (e.g. `hasAttachment`) and has to be rebuilt to answer the new filters.
 */
export function mailIndexStateIsCurrent(stored: StoredMailboxIndexState | undefined, uidValidity: string): boolean {
  return !!stored && stored.uidValidity === uidValidity && stored.schemaVersion === MAIL_INDEX_SCHEMA_VERSION
}
