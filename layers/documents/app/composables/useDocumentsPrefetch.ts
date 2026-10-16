import type { DocumentsDocument } from '#layers/documents/shared/types/documents'

/**
 * Document details fetched on row hover, kept app-wide so the detail page can
 * show them instantly and revalidate in the background.
 */
export function useDocumentsPrefetch() {
  const details = useState<Record<string, DocumentsDocument>>('documents:details', () => ({}))
  const key = (service: string, id: number) => `${service}:${id}`

  function cached(service: string, id: number): DocumentsDocument | undefined {
    return details.value[key(service, id)]
  }

  function remember(service: string, id: number, document: DocumentsDocument) {
    details.value = { ...details.value, [key(service, id)]: document }
  }

  async function prefetch(service: string, id: number) {
    if (!import.meta.client || !service || cached(service, id)) {
      return
    }
    try {
      remember(service, id, await documentsRequest<DocumentsDocument>(`/api/documents/${id}`, { query: { service } }))
    } catch {
      // A failed prefetch is not worth surfacing; opening the document retries
    }
  }

  return { cached, prefetch, remember }
}
