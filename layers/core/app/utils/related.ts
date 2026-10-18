import { entityKey } from '../../shared/entities'
import type { EntityRef, Relation } from '#layers/core/shared/types/entities'

/** The payload key a ref's related groups are cached under; shared by the panel and its hover prefetch. */
export function relatedKey(ref: EntityRef): string {
  return `entity-related:${entityKey(ref)}`
}

export interface SplitRelations {
  /** Structural links: from, attendee, correspondent, ... */
  structural: Relation[]
  /** Inferred links: the text merely mentions the entity */
  mentions: Relation[]
}

/** One group's relations split into the ones shown first and the weaker mentions shown under their own heading. */
export function splitRelations(relations: Relation[]): SplitRelations {
  return {
    structural: relations.filter(relation => relation.kind !== 'mentions'),
    mentions: relations.filter(relation => relation.kind === 'mentions')
  }
}
