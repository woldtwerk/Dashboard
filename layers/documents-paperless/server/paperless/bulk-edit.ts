import type { DocumentsBulkAction } from '../../../documents/shared/types/documents'

/** The body of `POST /api/documents/bulk_edit/`. */
export interface PaperlessBulkEditPayload {
  documents: number[]
  method: string
  parameters: Record<string, unknown>
  from_webui: boolean
}

/** The Paperless-ngx bulk edit request for a domain action on the given ids. */
export function toBulkEditPayload(documents: number[], action: DocumentsBulkAction): PaperlessBulkEditPayload {
  const payload: PaperlessBulkEditPayload = { documents, method: action.method, parameters: {}, from_webui: true }

  switch (action.method) {
    case 'add_tag':
    case 'remove_tag':
      payload.parameters = { tag: action.tag }
      break
    case 'set_correspondent':
      payload.parameters = { correspondent: action.correspondent }
      break
    case 'set_document_type':
      payload.parameters = { document_type: action.documentType }
      break
    case 'set_storage_path':
      payload.parameters = { storage_path: action.storagePath }
      break
    case 'rotate':
      payload.parameters = { degrees: action.degrees }
      break
    case 'merge':
      payload.parameters = {
        metadata_document_id: action.metadataDocumentId ?? null,
        delete_originals: action.deleteOriginals ?? false
      }
      break
    default:
      payload.parameters = {}
  }

  return payload
}
