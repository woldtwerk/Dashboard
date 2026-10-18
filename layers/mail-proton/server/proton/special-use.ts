/** Virtual folders Proton Bridge reports without a special-use flag */
const PROTON_SPECIAL_USE: Record<string, string> = {
  'All Mail': '\\All',
  'Starred': '\\Flagged'
}

/** Proton files user labels under `Labels/`; their mail also lives in a real folder */
const LABEL_PREFIX = 'Labels/'

/**
 * The special-use flag of a Proton Bridge folder: the one Bridge reports, or
 * the well-known flag of the virtual folder when Bridge leaves it empty.
 */
export function protonSpecialUse(path: string, reported?: string): string | undefined {
  return reported || PROTON_SPECIAL_USE[path]
}

/** Whether the path is a Proton label, which repeats mail stored in a real folder */
export function isProtonLabel(path: string): boolean {
  return path.startsWith(LABEL_PREFIX)
}
