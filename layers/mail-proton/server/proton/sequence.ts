/**
 * IMAP sequence numbers grow with arrival, so the newest mail sits at `exists`
 * and older mail at lower numbers. Paging walks down from there.
 */
export interface SequenceRange {
  start: number
  end: number
}

/**
 * The sequence-number window of one page, newest first. The start clamps at 1,
 * so the last page may be short; a page past the oldest mail is empty (undefined).
 */
export function sequenceRange(exists: number, offset: number, limit: number): SequenceRange | undefined {
  const end = exists - Math.max(0, offset)
  const start = Math.max(1, end - limit + 1)

  return limit >= 1 && end >= 1 ? { start, end } : undefined
}

/** The UIDs of one page, newest (highest UID) first */
export function uidPage(uids: number[], offset: number, limit: number): number[] {
  return [...uids].sort((a, b) => b - a).slice(offset, offset + limit)
}
