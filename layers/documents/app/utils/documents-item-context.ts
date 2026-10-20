import type { ItemActionContext } from '#layers/core/app/utils/item-actions'
import type { DocumentsDocument } from '#layers/documents/shared/types/documents'
import { entityKey } from '#layers/core/shared/entities'

/** Resolves the ids a document carries to the names other layers' actions read */
export interface DocumentsItemNames {
  tag?: (id: number) => string | undefined
  correspondent?: (id: number) => string | undefined
  documentType?: (id: number) => string | undefined
}

/**
 * The item context of one document for `ItemActionsMenu`: the domain owns the
 * fields, the actions other layers registered read them.
 */
export function documentsItemContext(
  document: DocumentsDocument,
  service: string,
  names: DocumentsItemNames = {}
): ItemActionContext {
  return {
    domain: 'documents',
    service,
    ref: entityKey({ type: 'document', service, id: String(document.id) }),
    item: {
      title: document.title,
      correspondent: document.correspondent === null ? undefined : names.correspondent?.(document.correspondent),
      documentType: document.documentType === null ? undefined : names.documentType?.(document.documentType),
      tags: document.tags.map(tag => names.tag?.(tag)).filter((name): name is string => !!name)
    }
  }
}
