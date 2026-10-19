import { z } from 'zod'
import type { DomainTool, ToolSource } from '../../core/shared/types/tools'
import { entityLink } from '../../core/shared/entities'
import type { DocumentsDocument, DocumentsQuery } from '../shared/types/documents'
import { EMPTY_DOCUMENTS_FILTERS } from '../shared/types/documents'

/** Document text sent to an assistant or MCP client per document. */
export const DOCUMENTS_TOOL_TEXT_LIMIT = 20_000
/** A tool search never returns more than this many documents. */
export const DOCUMENTS_TOOL_SEARCH_LIMIT = 25

export const documentsSearchInput = z.object({
  service: z.string().min(1).optional().describe('Documents service id; omit to search every configured archive'),
  query: z.string().trim().max(500).optional().describe('Full-text search in title and document content'),
  tags: z.array(z.number().int().nonnegative()).max(100).optional().describe('Only documents with any of these tag ids'),
  tagsMode: z.enum(['any', 'all']).default('any').describe('Whether documents need any or all of the `tags`'),
  correspondent: z.number().int().nonnegative().optional().describe('Only documents of this correspondent id'),
  documentType: z.number().int().nonnegative().optional().describe('Only documents of this document type id'),
  createdAfter: z.iso.date().optional().describe('Earliest document date, YYYY-MM-DD, inclusive'),
  createdBefore: z.iso.date().optional().describe('Latest document date, YYYY-MM-DD, inclusive'),
  limit: z.number().int().min(1).max(DOCUMENTS_TOOL_SEARCH_LIMIT).default(10).describe(`Maximum number of documents, at most ${DOCUMENTS_TOOL_SEARCH_LIMIT}`)
})

/** Maps tool input onto the domain list query. */
export function toDocumentsToolQuery(input: z.infer<typeof documentsSearchInput>): DocumentsQuery {
  return {
    page: 1,
    pageSize: input.limit,
    sort: 'added',
    order: 'desc',
    text: input.query || undefined,
    filters: {
      ...EMPTY_DOCUMENTS_FILTERS,
      tags: input.tags ?? [],
      tagsMode: input.tagsMode,
      correspondent: input.correspondent,
      documentType: input.documentType,
      created: { after: input.createdAfter, before: input.createdBefore }
    }
  }
}

/** A document list entry without the extracted content. */
export interface DocumentsToolSummary {
  service: string
  id: number
  title: string
  created: string
  correspondent: number | null
  documentType: number | null
  tags: number[]
  archiveSerialNumber: number | null
  mimeType: string
  pageCount: number | null
}

function toSummary(document: DocumentsDocument, service: string): DocumentsToolSummary {
  return {
    service,
    id: document.id,
    title: document.title,
    created: document.created,
    correspondent: document.correspondent,
    documentType: document.documentType,
    tags: document.tags,
    archiveSerialNumber: document.archiveSerialNumber,
    mimeType: document.mimeType,
    pageCount: document.pageCount
  }
}

function documentSource(document: DocumentsToolSummary): ToolSource {
  const serial = document.archiveSerialNumber

  return {
    kind: 'document',
    title: document.title || '(untitled document)',
    ...(serial !== null && serial !== undefined ? { subtitle: `#${serial}` } : {}),
    ...(document.created ? { date: document.created } : {}),
    link: entityLink({ type: 'document', service: document.service, id: String(document.id) })
  }
}

/** Source cards for `documents_search`: one row per found document. */
export function documentsSearchSources(output: unknown): ToolSource[] {
  const documents = (output as { documents?: DocumentsToolSummary[] } | undefined)?.documents
  if (!Array.isArray(documents)) {
    return []
  }

  return documents.map(documentSource)
}

/** Source card for `documents_get`: the one document that was read. */
export function documentsGetSources(output: unknown): ToolSource[] {
  const document = output as Partial<DocumentsToolSummary> | undefined
  return document?.id !== undefined && document.service ? [documentSource(document as DocumentsToolSummary)] : []
}

export const documentsTools: DomainTool[] = [
  {
    name: 'documents_search',
    domain: 'documents',
    description: `Search the document archive by text, tags, correspondent and date. Returns at most ${DOCUMENTS_TOOL_SEARCH_LIMIT} matching documents with their metadata; use documents_get for a document's content.`,
    input: documentsSearchInput,
    writes: false,
    execute: async (raw) => {
      const input = raw as z.infer<typeof documentsSearchInput>
      const query = toDocumentsToolQuery(input)
      const services = input.service ? [input.service] : (await listServices('documents')).map(item => item.id)
      const documents = []
      let count = 0

      for (const service of services) {
        try {
          const page = await (await useDocumentsProvider(service)).list(query)
          count += page.count
          documents.push(...page.results.map(document => toSummary(document, service)))
        } catch (error) {
          if (input.service) {
            throw error
          }
        }
      }

      return { count, documents: documents.slice(0, input.limit) }
    },
    sources: documentsSearchSources
  },
  {
    name: 'documents_get',
    domain: 'documents',
    description: `Read one document: its metadata and the extracted text, cut at ${DOCUMENTS_TOOL_TEXT_LIMIT} characters.`,
    input: z.object({
      service: z.string().min(1).describe('Documents service id'),
      id: z.number().int().nonnegative().describe('Document id')
    }),
    writes: false,
    execute: async (raw) => {
      const input = raw as { service: string, id: number }
      const provider = await useDocumentsProvider(input.service)
      const [document, metadata] = await Promise.all([provider.get(input.id), provider.metadata(input.id)])

      return {
        ...toSummary(document, input.service),
        content: (document.content ?? '').slice(0, DOCUMENTS_TOOL_TEXT_LIMIT),
        notes: document.notes,
        metadata
      }
    },
    sources: documentsGetSources
  },
  {
    name: 'documents_list_tags',
    domain: 'documents',
    description: 'List the archive tags with their ids, names, colours and document counts. Omit `service` to list every account.',
    input: z.object({ service: z.string().min(1).optional().describe('Documents service id; omit to list every configured archive') }),
    writes: false,
    execute: async (raw) => {
      const { service } = raw as { service?: string }
      const services = service ? [service] : (await listServices('documents')).map(item => item.id)

      return Promise.all(services.map(async (id) => {
        try {
          return { service: id, tags: await (await useDocumentsProvider(id)).listTags() }
        } catch (error) {
          return { service: id, tags: [], error: error instanceof Error ? error.message : 'Unavailable' }
        }
      }))
    }
  },
  {
    name: 'documents_list_correspondents',
    domain: 'documents',
    description: 'List the archive correspondents with their ids, names and document counts. Omit `service` to list every account.',
    input: z.object({ service: z.string().min(1).optional().describe('Documents service id; omit to list every configured archive') }),
    writes: false,
    execute: async (raw) => {
      const { service } = raw as { service?: string }
      const services = service ? [service] : (await listServices('documents')).map(item => item.id)

      return Promise.all(services.map(async (id) => {
        try {
          return { service: id, correspondents: await (await useDocumentsProvider(id)).listCorrespondents() }
        } catch (error) {
          return { service: id, correspondents: [], error: error instanceof Error ? error.message : 'Unavailable' }
        }
      }))
    }
  },
  {
    name: 'documents_update',
    domain: 'documents',
    description: 'Update one document\'s metadata: title, tags, correspondent, type or date. Use documents_list_tags and documents_list_correspondents for the ids.',
    input: z.object({
      service: z.string().min(1).describe('Documents service id'),
      id: z.number().int().nonnegative().describe('Document id'),
      title: z.string().trim().min(1).max(128).optional().describe('New title'),
      tags: z.array(z.number().int().nonnegative()).max(1000).optional().describe('Full replacement list of tag ids'),
      correspondent: z.number().int().nonnegative().nullable().optional().describe('Correspondent id, or null to clear it'),
      documentType: z.number().int().nonnegative().nullable().optional().describe('Document type id, or null to clear it'),
      created: z.iso.date().optional().describe('Document date, YYYY-MM-DD')
    }),
    writes: true,
    execute: async (raw) => {
      const { service, id, ...patch } = raw as { service: string, id: number } & Record<string, unknown>
      const updated = await (await useDocumentsProvider(service)).update(id, patch)
      await publishDomainEvent({ domain: 'documents', service, type: 'changed', resource: String(id) })

      return toSummary(updated, service)
    }
  },
  {
    name: 'documents_add_note',
    domain: 'documents',
    description: 'Add a plain-text note to a document and return the document\'s notes.',
    input: z.object({
      service: z.string().min(1).describe('Documents service id'),
      id: z.number().int().nonnegative().describe('Document id'),
      note: z.string().trim().min(1).max(10_000).describe('Note text')
    }),
    writes: true,
    execute: async (raw) => {
      const input = raw as { service: string, id: number, note: string }
      const notes = await (await useDocumentsProvider(input.service)).addNote(input.id, input.note)
      await publishDomainEvent({ domain: 'documents', service: input.service, type: 'changed', resource: String(input.id) })

      return { notes }
    }
  }
]
