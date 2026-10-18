// The highlight markers and the escaping renderer are shared across domains;
// see layers/core/shared/highlight. Re-exported here so mail code and its tests
// keep importing them from the mail layer.
export {
  escapeHtml,
  highlightToHtml,
  HIGHLIGHT_POST_TAG,
  HIGHLIGHT_PRE_TAG,
  stripHighlights
} from '../../core/shared/highlight'
