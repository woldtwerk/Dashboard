import type { RelationKind } from '#layers/core/shared/types/entities'

export interface RelatedDocumentBadge {
  label: string
  color: 'primary' | 'neutral'
}

/** How a document is related: the sender of the document, or a weaker mention in its text. */
export function documentRelationBadge(kind: RelationKind): RelatedDocumentBadge {
  return kind === 'correspondent'
    ? { label: 'Correspondent', color: 'primary' }
    : { label: 'Mentioned', color: 'neutral' }
}
