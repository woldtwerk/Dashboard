/** A selection is capped, so a shared link cannot grow without bound */
export const DOCUMENTS_SELECTION_MAX = 200

/**
 * The URL form `?sel=1,2,3`. `null` means the key is removed from the query.
 * Ids are plain numbers, so no encoding is needed.
 */
export function documentsSelectionToQuery(selection: number[]): string | null {
  const capped = selection.slice(0, DOCUMENTS_SELECTION_MAX)
  return capped.length ? capped.join(',') : null
}

/** The selection from the URL; malformed ids are dropped and the cap applies */
export function documentsSelectionFromQuery(query: { sel?: unknown }): number[] {
  const values = Array.isArray(query.sel)
    ? query.sel.filter((value): value is string => typeof value === 'string')
    : typeof query.sel === 'string' ? [query.sel] : []
  const selection: number[] = []
  const seen = new Set<number>()

  for (const value of values) {
    for (const part of value.split(',')) {
      const id = Number(part)
      if (!Number.isInteger(id) || id <= 0 || seen.has(id)) {
        continue
      }

      seen.add(id)
      selection.push(id)
      if (selection.length >= DOCUMENTS_SELECTION_MAX) {
        return selection
      }
    }
  }

  return selection
}

/** Ctrl/⌘-click: add the document to the selection, or remove it if it is already in */
export function toggleDocumentSelection(selection: number[], id: number): number[] {
  return selection.includes(id)
    ? selection.filter(candidate => candidate !== id)
    : [...selection, id]
}

/**
 * Shift-click: every document between the anchor and the target, in the list's
 * own order. Without a usable anchor the target alone is selected.
 */
export function rangeDocumentSelection(keys: number[], anchor: number | undefined, target: number): number[] {
  const start = anchor === undefined ? -1 : keys.indexOf(anchor)
  const end = keys.indexOf(target)
  if (start < 0 || end < 0) {
    return [target]
  }

  const [from, to] = start <= end ? [start, end] : [end, start]
  return keys.slice(from, to + 1)
}
