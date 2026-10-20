import type { Settings, TypoTolerance } from 'meilisearch'
import { HIGHLIGHT_POST_TAG, HIGHLIGHT_PRE_TAG } from '../../../mail/shared/mail-highlight'

export { HIGHLIGHT_POST_TAG, HIGHLIGHT_PRE_TAG }

/** Name of the embedder the hybrid search uses */
export const EMBEDDER = 'default'

/**
 * Hybrid results are scored on a blend of the semantic similarity and the keyword
 * ranking. Meilisearch's ranking rules give a typo match ("Rechnnug" → "Rechnung")
 * only the lower end of the keyword scale, so the semantic threshold would drop
 * exactly the hit the user meant. The configured `rankingScoreThreshold` therefore
 * only guards the pure semantic case, where it keeps the embedder from returning
 * the whole mailbox. With a keyword part the threshold is relaxed to this floor:
 * low enough for typo matches, high enough to trim the unrelated semantic tail.
 */
export const HYBRID_RANKING_SCORE_FLOOR = 0.2

/**
 * How deep a single query may page into the index. Meilisearch's default of 1000
 * hits would end the mail list and the conversation paging there, so the index
 * is configured to cover a mailbox's whole depth instead.
 */
export const MAIL_INDEX_MAX_TOTAL_HITS = 100_000

export interface MailIndexSettingsOptions {
  semantic: boolean
  embedderModel: string
  typoTolerance: boolean
  typoOneTypo: number
  typoTwoTypos: number
  typoDisableOnNumbers: boolean
  typoDisableOnAttributes: string[]
}

/** Explicit typo tolerance, so "Rechnnug" finds "Rechnung" regardless of the server defaults */
export function buildTypoTolerance(options: MailIndexSettingsOptions): TypoTolerance {
  return {
    enabled: options.typoTolerance,
    // No attribute is exempt; mail is short and every field may be searched with a typo
    disableOnAttributes: options.typoDisableOnAttributes,
    // Amounts, receipt numbers and dates must stay exact
    disableOnNumbers: options.typoDisableOnNumbers,
    minWordSizeForTypos: {
      oneTypo: options.typoOneTypo,
      twoTypos: options.typoTwoTypos
    }
  }
}

/** Settings applied to the mail index before the first write or search */
export function buildIndexSettings(options: MailIndexSettingsOptions): Settings {
  return {
    searchableAttributes: ['subject', 'fromText', 'toText', 'text'],
    filterableAttributes: ['service', 'mailbox', 'unread', 'flagged', 'hasAttachment', 'date', 'fromTerms', 'participantTerms', 'conversationKeys', 'listId', 'labels', 'messageId'],
    sortableAttributes: ['date'],
    // The same mail in several folders/labels is shown once
    distinctAttribute: 'messageId',
    // "Load more" reaches past Meilisearch's default hit limit
    pagination: { maxTotalHits: MAIL_INDEX_MAX_TOTAL_HITS },
    typoTolerance: buildTypoTolerance(options),
    embedders: options.semantic
      ? {
          [EMBEDDER]: {
            source: 'huggingFace',
            model: options.embedderModel,
            documentTemplate: 'From: {{doc.fromText}}\nSubject: {{doc.subject}}\n{{doc.text}}',
            documentTemplateMaxBytes: 1000
          }
        }
      : {}
  }
}

/** The `rankingScoreThreshold` a search may use; see HYBRID_RANKING_SCORE_FLOOR */
export function rankingScoreThresholdFor(semantic: boolean, semanticRatio: number, threshold: number): number | undefined {
  if (!semantic || threshold <= 0) {
    return undefined
  }

  return semanticRatio >= 1 ? threshold : Math.min(threshold, HYBRID_RANKING_SCORE_FLOOR)
}
