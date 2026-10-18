import { DEFAULT_SORT } from '../../shared/documents-query'
import { EMPTY_DOCUMENTS_FILTERS } from '../../shared/types/documents'

/** One document of a global search: what the palette shows, without the full document */
export interface DocumentsSearchHit {
  service: string
  id: number
  title: string
  snippet?: string
  created: string
  correspondent?: string
}

/**
 * Full-text search across every document service, best match first. Paperless
 * ranks by relevance for a text query, so no sort is forced here.
 */
export async function searchDocuments(query: string, limit = 5): Promise<DocumentsSearchHit[]> {
  const services = await listServices('documents')

  const hits = await Promise.all(services.map(async ({ id }): Promise<DocumentsSearchHit[]> => {
    try {
      const provider = await useDocumentsProvider(id)
      const [page, correspondents] = await Promise.all([
        provider.list({
          page: 1,
          pageSize: limit,
          sort: DEFAULT_SORT,
          order: 'desc',
          text: query,
          filters: structuredClone(EMPTY_DOCUMENTS_FILTERS)
        }),
        provider.listCorrespondents()
      ])
      const names = new Map(correspondents.map(item => [item.id, item.name]))

      return page.results.map(document => ({
        service: id,
        id: document.id,
        title: document.title,
        snippet: document.snippet,
        created: document.created,
        correspondent: document.correspondent === null ? undefined : names.get(document.correspondent)
      }))
    } catch {
      // One unreadable archive must not hide the others
      return []
    }
  }))

  return hits.flat().slice(0, Math.max(0, limit))
}
