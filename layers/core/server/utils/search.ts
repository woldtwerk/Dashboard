import type { SearchGroup, SearchHit } from '../../shared/types/search'
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
 * Every registered provider's hits for one query, run in parallel. A provider
 * that fails or exceeds its timeout is logged and skipped, so one broken service
 * never hides the others. Empty groups are left out.
 */
export async function searchAll(q: string, limit = 5, timeoutMs = SEARCH_TIMEOUT_MS): Promise<SearchGroup[]> {
  const groups = await Promise.all([...providers.values()].map(async (provider): Promise<SearchGroup | undefined> => {
    try {
      const hits = await withTimeout(provider.search(q, limit), timeoutMs)
      if (!hits.length) {
        return undefined
      }

      return { domain: provider.domain, label: provider.label, icon: provider.icon, hits }
    } catch (error) {
      useServiceLogger('core').warn(`Search of "${provider.domain}" is unavailable`, { error: errorText(error) })
      return undefined
    }
  }))

  return groups.filter((group): group is SearchGroup => !!group)
}
