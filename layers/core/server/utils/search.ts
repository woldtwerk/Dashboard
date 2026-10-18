import type { SearchGroup, SearchHit, SearchResults } from '../../shared/types/search'
import { highlightTerms, isHighlighted, isSemanticHit, relevance } from '../../shared/search-ranking'
import { withTimeout } from './dashboard'
import { useServiceLogger } from './service-logger'

/** What one domain contributes to the global search */
export interface SearchProvider {
  domain: string
  label: string
  icon?: string
  search(q: string, limit: number): Promise<SearchHit[]>
}

/** A provider that takes longer than this is left out of the result */
export const SEARCH_TIMEOUT_MS = 3_000

const providers = new Map<string, SearchProvider>()

/** Called by a domain layer's Nitro plugin; the core knows nothing domain-specific */
export function registerSearchProvider(provider: SearchProvider) {
  providers.set(provider.domain, provider)
}

/** Test hook; a server registers its providers once at startup */
export function resetSearchProviders() {
  providers.clear()
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Fills in the highlight a provider did not make, so every listed hit shows
 * where it matched. A wildcard match (Paperless) or a plain substring match
 * (contacts) carries no markers of its own. A semantic hit has no text match
 * and keeps its fields as they are.
 */
function withHighlights(hit: SearchHit, query: string): SearchHit {
  const filled = { ...hit }

  if (isSemanticHit(filled)) {
    return filled
  }

  if (!isHighlighted(filled.titleHighlight)) {
    filled.titleHighlight = highlightTerms(filled.title, query)
  }
  if (filled.snippet && !isHighlighted(filled.snippet)) {
    filled.snippet = highlightTerms(filled.snippet, query)
  }
  if (filled.subtitle && !isHighlighted(filled.subtitleHighlight)) {
    filled.subtitleHighlight = highlightTerms(filled.subtitle, query)
  }

  return filled
}

interface ScoredHit {
  hit: SearchHit
  score: number
  domain: string
  label: string
  icon?: string
}

/** A keyword hit always sorts above a semantic one; the score breaks ties. */
function compareHits(a: ScoredHit, b: ScoredHit): number {
  if (isSemanticHit(a.hit) !== isSemanticHit(b.hit)) {
    return isSemanticHit(a.hit) ? 1 : -1
  }

  return b.score - a.score
}

/**
 * Every registered provider's hits for one query, run in parallel. A provider
 * that fails or exceeds its timeout is logged and skipped, so one broken service
 * never hides the others.
 *
 * Each hit is scored against the query; a hit without a match is dropped, which
 * is how a provider's semantic tail is kept out of the result. Groups keep only
 * the best `limit` hits and are ordered by their best hit. `top` holds the best
 * keyword hits across every domain and only fills up with semantic hits when
 * there are fewer than `limit` keyword hits.
 */
export async function searchAll(q: string, limit = 5, timeoutMs = SEARCH_TIMEOUT_MS): Promise<SearchResults> {
  const scored = await Promise.all([...providers.values()].map(async (provider): Promise<ScoredHit[]> => {
    try {
      const hits = await withTimeout(provider.search(q, limit), timeoutMs)
      if (!hits.length) {
        return []
      }

      return hits
        .map((hit): ScoredHit => ({
          hit: withHighlights(hit, q),
          score: relevance(hit, q),
          domain: provider.domain,
          label: provider.label,
          icon: provider.icon
        }))
        .filter(item => item.score > 0)
        .sort(compareHits)
        .slice(0, Math.max(0, limit))
    } catch (error) {
      useServiceLogger('core').warn(`Search of "${provider.domain}" is unavailable`, { error: errorText(error) })
      return []
    }
  }))

  const groups: SearchGroup[] = scored
    .filter(hits => hits.length)
    .sort((a, b) => compareHits(a[0]!, b[0]!))
    .map(hits => ({
      domain: hits[0]!.domain,
      label: hits[0]!.label,
      icon: hits[0]!.icon,
      hits: hits.map(item => item.hit)
    }))

  const ordered = scored.flat().sort(compareHits)
  const keyword = ordered.filter(item => !isSemanticHit(item.hit))
  const semantic = ordered.filter(item => isSemanticHit(item.hit))
  const best = keyword.slice(0, Math.max(0, limit))
  if (best.length < limit) {
    best.push(...semantic.slice(0, limit - best.length))
  }

  const seen = new Set<string>()
  const top = best
    .filter((item) => {
      if (seen.has(item.hit.ref)) {
        return false
      }
      seen.add(item.hit.ref)
      return true
    })
    .map(item => ({ ...item.hit, domain: item.domain, domainLabel: item.label, icon: item.icon }))

  return { top, groups }
}
