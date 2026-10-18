/**
 * Markers an index wraps around matched terms; configured in the search adapters
 * (Meilisearch, Paperless, FTS5). Private-use codepoints, not HTML: the text is
 * escaped first, then the markers become `<mark>` tags, so a literal "<mark>"
 * inside content is escaped like any other text.
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
 * Escapes text for HTML and turns the index' balanced highlight markers into
 * `<mark>` tags. Plain text (no markers, e.g. from the provider) is escaped as
 * a whole.
 */
export function highlightToHtml(value?: string): string {
  if (!value) {
    return ''
  }

  return escapeHtml(value)
    .replaceAll(HIGHLIGHT_PRE_TAG, '<mark>')
    .replaceAll(HIGHLIGHT_POST_TAG, '</mark>')
}

/** The text without its highlight markers, e.g. for copy or an excerpt. */
export function stripHighlights(value?: string): string {
  return value?.replaceAll(HIGHLIGHT_PRE_TAG, '').replaceAll(HIGHLIGHT_POST_TAG, '') ?? ''
}
