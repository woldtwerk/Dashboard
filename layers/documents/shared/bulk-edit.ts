import type { DocumentsBulkAction, DocumentsDocument } from './types/documents'

/**
 * The document list a bulk action is expected to produce, so the UI can show it
 * at once and roll back if the request fails. Only operations whose outcome is
 * fully known here (tags, correspondent, type, storage path, delete) change the
 * list; rotate/reprocess/merge return it unchanged.
 */
export function applyBulkAction(documents: DocumentsDocument[], ids: number[], action: DocumentsBulkAction): DocumentsDocument[] {
  const selected = new Set(ids)

  switch (action.method) {
    case 'add_tag':
      return documents.map(document => selected.has(document.id) && !document.tags.includes(action.tag)
        ? { ...document, tags: [...document.tags, action.tag] }
        : document)
    case 'remove_tag':
      return documents.map(document => selected.has(document.id)
        ? { ...document, tags: document.tags.filter(tag => tag !== action.tag) }
        : document)
    case 'set_correspondent':
      return documents.map(document => selected.has(document.id)
        ? { ...document, correspondent: action.correspondent }
        : document)
    case 'set_document_type':
      return documents.map(document => selected.has(document.id)
        ? { ...document, documentType: action.documentType }
        : document)
    case 'set_storage_path':
      return documents.map(document => selected.has(document.id)
        ? { ...document, storagePath: action.storagePath }
        : document)
    case 'delete':
      return documents.filter(document => !selected.has(document.id))
    default:
      return documents
  }
}

/** A short label for the action, e.g. for the confirmation dialog. */
export function bulkActionLabel(action: DocumentsBulkAction, name: (id: number | null) => string): string {
  switch (action.method) {
    case 'add_tag':
      return `Add tag "${name(action.tag)}"`
    case 'remove_tag':
      return `Remove tag "${name(action.tag)}"`
    case 'set_correspondent':
      return action.correspondent === null ? 'Clear correspondent' : `Set correspondent "${name(action.correspondent)}"`
    case 'set_document_type':
      return action.documentType === null ? 'Clear document type' : `Set document type "${name(action.documentType)}"`
    case 'set_storage_path':
      return action.storagePath === null ? 'Clear storage path' : `Set storage path "${name(action.storagePath)}"`
    case 'delete':
      return 'Delete'
    case 'reprocess':
      return 'Reprocess'
    case 'rotate':
      return `Rotate ${action.degrees}°`
    case 'merge':
      return 'Merge'
  }
}
