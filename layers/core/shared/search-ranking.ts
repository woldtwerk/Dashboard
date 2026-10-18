import { HIGHLIGHT_POST_TAG, HIGHLIGHT_PRE_TAG, stripHighlights } from './highlight'
import type { SearchHit } from './types/search'

/**
 * Word characters; a term and a word are compared after folding, so "Zeugnis"
 * and "zeugnis" are the same word and "Zwischenzeugnis" contains it as a part.
 */
const WORD = /[\p{L}\p{N}]+/gu

/**
 * A semantic hit is only kept above this provider score. It matches the intent
 * of the mail index' ranking threshold (`rankingScoreThresholdFor` guards the
 * semantic tail); the mail provider reports Meilisearch's `_rankingScore`.
 */
export const SEMANTIC_MIN_SCORE = 0.5

/** Lower-cased and diacritics folded, the form both ranking and highlight compare in. */
export function foldSearchText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** The folded words a free-text query is made of; the AND units of a match. */
export function searchTerms(query: string): string[] {
  return foldSearchText(query).match(WORD) ?? []
}

function words(text: string): string[] {
  return foldSearchText(stripHighlights(text)).match(WORD) ?? []
}

/** 0 when the term is absent, `whole`/`part` when it is a word or part of one. */
function wordScore(term: string, text: string, whole: number, part: number): number {
  const tokens = words(text)
  if (tokens.includes(term)) {
    return whole
  }

  return tokens.some(token => token.includes(term)) ? part : 0
}

/** Whether the provider found the query semantically, without a text match. */
export function isSemanticHit(hit: Pick<SearchHit, 'match'>): boolean {
  return hit.match === 'semantic'
}

/**
 * How well one hit answers the query, 0 when it is dropped.
 *
 * A keyword hit has to match every query term somewhere (AND) in title, snippet
 * or subtitle; the strongest field per term counts, in the weights above. A
 * semantic hit (mail only) is kept when the provider scores it at least
 * `SEMANTIC_MIN_SCORE` and then scores low, so every keyword hit ranks above it.
 */
export function relevance(
  hit: Pick<SearchHit, 'title' | 'titleHighlight' | 'snippet' | 'subtitle' | 'match' | 'providerScore'>,
  query: string
): number {
  if (isSemanticHit(hit)) {
    const providerScore = typeof hit.providerScore === 'number' && Number.isFinite(hit.providerScore) ? hit.providerScore : 0
    if (providerScore < SEMANTIC_MIN_SCORE) {
      return 0
    }

    return 0.1 + 0.3 * Math.min(1, providerScore)
  }

  const terms = searchTerms(query)
  if (!terms.length) {
    return 0
  }

  let total = 0
  for (const term of terms) {
    const score = Math.max(
      wordScore(term, hit.titleHighlight ?? hit.title, 1, 0.85),
      wordScore(term, hit.snippet ?? '', 0.6, 0.5),
      wordScore(term, hit.subtitle ?? '', 0.3, 0.3)
    )

    if (score === 0) {
      return 0
    }

    total += score
  }

  return total / terms.length
}

/** Folds `text` and keeps, per folded character, the index it came from. */
function foldWithMap(text: string): { folded: string, map: number[] } {
  const characters: string[] = []
  const map: number[] = []

  for (let index = 0; index < text.length; index++) {
    const folded = foldSearchText(text[index]!)
    for (const character of folded) {
      characters.push(character)
      map.push(index)
    }
  }

  return { folded: characters.join(''), map }
}

/**
 * Wraps every case- and diacritics-insensitive occurrence of the query terms in
 * the shared highlight sentinels. The text is not escaped; `highlightToHtml`
 * escapes first and only then turns the balanced markers into `<mark>`.
 */
export function highlightTerms(text: string, query: string): string {
  const terms = searchTerms(query)
  if (!text || !terms.length) {
    return text
  }

  const { folded, map } = foldWithMap(text)
  const ranges: Array<[number, number]> = []

  for (const term of terms) {
    let index = folded.indexOf(term)
    while (index !== -1) {
      ranges.push([map[index]!, map[index + term.length - 1]! + 1])
      index = folded.indexOf(term, index + term.length)
    }
  }

  if (!ranges.length) {
    return text
  }

  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1])
    } else {
      merged.push([...range])
    }
  }

  let result = ''
  let cursor = 0
  for (const [start, end] of merged) {
    result += text.slice(cursor, start) + HIGHLIGHT_PRE_TAG + text.slice(start, end) + HIGHLIGHT_POST_TAG
    cursor = end
  }

  return result + text.slice(cursor)
}

/** Whether a string already carries a provider-made highlight marker. */
export function isHighlighted(value?: string): boolean {
  return !!value?.includes(HIGHLIGHT_PRE_TAG)
}
