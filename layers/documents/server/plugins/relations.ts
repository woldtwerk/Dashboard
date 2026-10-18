import { entityLink, normalizeEmail } from '../../../core/shared/entities'
import type { EntityRef, Relation, RelationKind } from '../../../core/shared/types/entities'
import { registerRelationProvider } from '../../../core/server/utils/relations'
import { EMPTY_DOCUMENTS_FILTERS } from '../../shared/types/documents'
import type { DocumentsCorrespondent, DocumentsDocument, DocumentsQuery } from '../../shared/types/documents'
import {
  correspondentEmail,
  correspondentMatches,
  dedupeRelations,
  extractEmails,
  quotedSearchTerms
} from '../utils/documents-relations'

function documentRef(service: string, document: DocumentsDocument): EntityRef {
  return { type: 'document', service, id: String(document.id) }
}

function personRef(email: string): EntityRef {
  return { type: 'person', id: email }
}

function documentQuery(text: string | undefined, correspondent: number | undefined, limit: number): DocumentsQuery {
  return {
    page: 1,
    pageSize: Math.max(1, limit) + 1,
    sort: 'created',
    order: 'desc',
    text,
    filters: { ...EMPTY_DOCUMENTS_FILTERS, ...(correspondent === undefined ? {} : { correspondent }) }
  }
}

function documentRelation(
  service: string,
  document: DocumentsDocument,
  kind: RelationKind,
  weight: number,
  correspondent?: DocumentsCorrespondent
): Relation {
  const ref = documentRef(service, document)

  return {
    kind,
    weight,
    item: {
      ref,
      title: document.title,
      subtitle: correspondent?.name,
      at: document.created,
      to: entityLink(ref),
      icon: 'i-lucide-file-text'
    }
  }
}

function personRelation(email: string, kind: RelationKind, title: string, at?: string): Relation {
  const ref = personRef(email)

  return {
    kind,
    weight: kind === 'mentions' ? 0.5 : 1,
    item: {
      ref,
      title,
      subtitle: title === email ? undefined : email,
      at,
      to: entityLink(ref),
      icon: 'i-lucide-user'
    }
  }
}

async function relatedToPerson(email: string, limit: number): Promise<Relation[]> {
  // The contact name lets a correspondent that is named after the person match too
  const personName = (await resolvePerson(email))?.name
  const services = await listServices('documents')
  const relations: Relation[] = []

  for (const { id } of services) {
    try {
      const provider = await useDocumentsProvider(id)
      // One taxonomy call serves every correspondent match of this request
      const correspondents = await provider.listCorrespondents()
      const matching = correspondents.filter(correspondent => correspondentMatches(correspondent, email, personName))

      for (const correspondent of matching) {
        const page = await provider.list(documentQuery(undefined, correspondent.id, limit))
        for (const document of page.results) {
          relations.push(documentRelation(id, document, 'correspondent', 1, correspondent))
        }
      }

      for (const term of quotedSearchTerms(email, personName)) {
        const page = await provider.list(documentQuery(term, undefined, limit))
        for (const document of page.results) {
          const correspondent = correspondents.find(item => item.id === document.correspondent)
          relations.push(documentRelation(id, document, 'mentions', 0.5, correspondent))
        }
      }
    } catch (error) {
      useServiceLogger('documents', id).warn('Could not search documents', { error: String(error) })
    }
  }

  return dedupeRelations(relations).slice(0, Math.max(0, limit) + 1)
}

async function relatedToDocument(ref: EntityRef, limit: number): Promise<Relation[]> {
  const id = Number(ref.id)
  if (!Number.isInteger(id)) {
    return []
  }

  const services = ref.service
    ? [{ id: ref.service }]
    : await listServices('documents')
  const relations: Relation[] = []

  for (const service of services) {
    try {
      const provider = await useDocumentsProvider(service.id)
      const [document, correspondents] = await Promise.all([
        provider.get(id),
        provider.listCorrespondents()
      ])
      const correspondent = correspondents.find(item => item.id === document.correspondent)
      const email = correspondent ? correspondentEmail(correspondent) : undefined

      if (correspondent && email) {
        relations.push(personRelation(email, 'correspondent', correspondent.name || email, document.created))
      }

      for (const mention of extractEmails(document.content)) {
        relations.push(personRelation(mention, 'mentions', mention, document.created))
      }
    } catch (error) {
      useServiceLogger('documents', service.id).warn('Could not read a document', { error: String(error) })
    }
  }

  return dedupeRelations(relations).slice(0, Math.max(0, limit) + 1)
}

export default defineNitroPlugin(() => {
  registerRelationProvider('documents', {
    label: 'Documents',
    related(ref, { limit }) {
      if (ref.type === 'person') {
        return relatedToPerson(normalizeEmail(ref.id) ?? ref.id, limit)
      }
      return ref.type === 'document' ? relatedToDocument(ref, limit) : Promise.resolve([])
    }
  })
})
