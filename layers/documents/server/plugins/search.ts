import { entityKey, entityLink } from '../../../core/shared/entities'
import type { EntityRef } from '../../../core/shared/types/entities'
import type { SearchHit } from '../../../core/shared/types/search'
import { registerSearchProvider } from '../../../core/server/utils/search'
import { formatDate } from '../../shared/documents-format'

export default defineNitroPlugin(() => {
  registerSearchProvider({
    domain: 'documents',
    label: 'Documents',
    icon: 'i-lucide-file-search',
    async search(q, limit): Promise<SearchHit[]> {
      const hits = await searchDocuments(q, limit)

      return hits.map((hit): SearchHit => {
        const ref: EntityRef = { type: 'document', service: hit.service, id: String(hit.id) }

        return {
          ref: entityKey(ref),
          title: hit.title,
          snippet: hit.snippet,
          subtitle: [hit.correspondent, formatDate(hit.created)].filter(Boolean).join(' · '),
          to: entityLink(ref),
          date: hit.created
        }
      })
    }
  })
})
