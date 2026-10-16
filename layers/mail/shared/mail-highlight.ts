/**
 * Markers Meilisearch wraps around matched terms; configured in the Meilisearch adapter.
 * Private-use codepoints, not HTML: mail text is escaped first, then the markers become
 * `<mark>` tags, so a literal "<mark>" inside a mail is escaped like any other text.
 */
export const HIGHLIGHT_PRE_TAG = '\uE000'
export const HIGHLIGHT_POST_TAG = '\uE001'

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;'
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => HTML_ESCAPES[char]!)
}

/**
 * Escapes mail text for HTML and turns the index' balanced highlight markers into `<mark>` tags.
 * Plain text (no markers, e.g. from the provider) is escaped as a whole.
 */
export function highlightToHtml(value?: string): string {
  if (!value) {
    return ''
  }

  return escapeHtml(value)
    .replaceAll(HIGHLIGHT_PRE_TAG, '<mark>')
    .replaceAll(HIGHLIGHT_POST_TAG, '</mark>')
}
