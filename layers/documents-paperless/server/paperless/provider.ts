import { createError } from 'nuxt/server'
import type { SetupValues } from '../../../core/shared/types/setup'
import type {
  DocumentsBulkAction,
  DocumentsCorrespondent,
  DocumentsCustomField,
  DocumentsDocumentPatch,
  DocumentsDocumentType,
  DocumentsSavedView,
  DocumentsStoragePath,
  DocumentsTag
} from '../../../documents/shared/types/documents'
import type { DocumentsProvider } from '../../../documents/server/utils/documents-provider'
import { createPaperlessClient } from './client'
import type { PaperlessClient } from './client'
import { toBulkEditPayload } from './bulk-edit'
import { toPaperlessParams } from './query'
import {
  toCorrespondent,
  toCorrespondentBody,
  toCustomField,
  toCustomFieldBody,
  toDocument,
  toDocumentPatch,
  toDocumentType,
  toDocumentTypeBody,
  toHistory,
  toMetadata,
  toNote,
  toPage,
  toSavedView,
  toSavedViewBody,
  toShareLink,
  toStoragePath,
  toStoragePathBody,
  toTag,
  toTagBody,
  toTask
} from './mapping'
import type {
  PaperlessCorrespondentDto,
  PaperlessCustomFieldDto,
  PaperlessDocumentDto,
  PaperlessDocumentTypeDto,
  PaperlessHistoryDto,
  PaperlessMetadataDto,
  PaperlessNoteDto,
  PaperlessPageDto,
  PaperlessSavedViewDto,
  PaperlessShareLinkDto,
  PaperlessStoragePathDto,
  PaperlessTagDto,
  PaperlessTaskDto
} from './mapping'

/** The API lists are small enough to fetch in one big page for filter dropdowns. */
const TAXONOMY_PAGE_SIZE = 1000

export function createPaperlessProvider(values: SetupValues): DocumentsProvider {
  const client: PaperlessClient = createPaperlessClient({ url: String(values.url ?? ''), token: String(values.token ?? '') })

  const getCustomField = (id: number) => client.request<PaperlessCustomFieldDto>(`/api/custom_fields/${id}/`).then(toCustomField)

  async function listAll<TDto, TDomain>(path: string, map: (dto: TDto) => TDomain): Promise<TDomain[]> {
    const page = await client.request<PaperlessPageDto<TDto>>(path, { query: { page_size: TAXONOMY_PAGE_SIZE } })
    return page.results.map(map)
  }

  return {
    async list(query) {
      // The custom field filter addresses the field by name, so resolve it first
      let customField: DocumentsCustomField | undefined
      if (query.filters.customField) {
        customField = await getCustomField(query.filters.customField.field).catch(() => undefined)
      }

      const page = await client.request<PaperlessPageDto<PaperlessDocumentDto>>('/api/documents/', {
        query: toPaperlessParams(query, customField)
      })
      return toPage(page, query.page, query.pageSize, toDocument)
    },

    async get(id) {
      return toDocument(await client.request<PaperlessDocumentDto>(`/api/documents/${id}/`))
    },

    async update(id, patch: DocumentsDocumentPatch) {
      return toDocument(await client.request<PaperlessDocumentDto>(`/api/documents/${id}/`, { method: 'PATCH', json: toDocumentPatch(patch) }))
    },

    async remove(id) {
      await client.request(`/api/documents/${id}/`, { method: 'DELETE' })
    },

    async countInbox() {
      const page = await client.request<{ count: number }>('/api/documents/', {
        query: { is_in_inbox: true, page_size: 1 }
      })
      return page.count
    },

    async countAdded(since, until) {
      const page = await client.request<{ count: number }>('/api/documents/', {
        query: { added__date__gte: since, added__date__lt: until, page_size: 1 }
      })
      return page.count
    },

    async ping() {
      await client.request('/api/')
    },

    thumbnail: id => client.stream(`/api/documents/${id}/thumb/`),
    preview: id => client.stream(`/api/documents/${id}/preview/`),
    download: (id, options) => client.stream(`/api/documents/${id}/download/`, { query: { original: options.original } }),

    async upload(upload) {
      const body = await client.request<string>('/api/documents/post_document/', {
        method: 'POST',
        body: upload.stream,
        contentType: upload.contentType,
        contentLength: upload.contentLength
      })
      return body
    },

    async metadata(id) {
      return toMetadata(await client.request<PaperlessMetadataDto>(`/api/documents/${id}/metadata/`))
    },

    async suggestions(id) {
      const dto = await client.request<{ correspondents: number[], tags: number[], document_types: number[], storage_paths: number[], dates: string[] }>(`/api/documents/${id}/suggestions/`)
      const [tags, correspondents, documentTypes, storagePaths] = await Promise.all([
        listAll<PaperlessTagDto, DocumentsTag>('/api/tags/', toTag),
        listAll<PaperlessCorrespondentDto, DocumentsCorrespondent>('/api/correspondents/', toCorrespondent),
        listAll<PaperlessDocumentTypeDto, DocumentsDocumentType>('/api/document_types/', toDocumentType),
        listAll<PaperlessStoragePathDto, DocumentsStoragePath>('/api/storage_paths/', toStoragePath)
      ])

      const only = <T extends { id: number }>(items: T[], wanted: number[]) => items.filter(item => wanted.includes(item.id))
      return {
        tags: only(tags, dto.tags),
        correspondents: only(correspondents, dto.correspondents),
        documentTypes: only(documentTypes, dto.document_types),
        storagePaths: only(storagePaths, dto.storage_paths),
        dates: dto.dates
      }
    },

    async history(id) {
      try {
        const entries = await client.request<PaperlessHistoryDto[]>(`/api/documents/${id}/history/`)
        return entries.map(toHistory)
      } catch {
        // History is optional and may be disabled; treat any failure as "none"
        return []
      }
    },

    async listNotes(id) {
      const notes = await client.request<PaperlessNoteDto[]>(`/api/documents/${id}/notes/`)
      return notes.map(toNote)
    },

    async addNote(id, note) {
      const notes = await client.request<PaperlessNoteDto[]>(`/api/documents/${id}/notes/`, { method: 'POST', json: { note } })
      return notes.map(toNote)
    },

    async removeNote(id, noteId) {
      await client.request(`/api/documents/${id}/notes/`, { method: 'DELETE', query: { id: noteId } })
    },

    async listShareLinks(id) {
      const links = await client.request<PaperlessShareLinkDto[]>(`/api/documents/${id}/share_links/`)
      return links.map(toShareLink)
    },

    async createShareLink(id, options) {
      return toShareLink(await client.request<PaperlessShareLinkDto>('/api/share_links/', {
        method: 'POST',
        json: { document: id, file_version: options.fileVersion ?? 'archive', expiration: options.expiration ?? null }
      }))
    },

    async removeShareLink(_id, linkId) {
      await client.request(`/api/share_links/${linkId}/`, { method: 'DELETE' })
    },

    async bulkEdit(documents, action: DocumentsBulkAction) {
      await client.request('/api/documents/bulk_edit/', { method: 'POST', json: toBulkEditPayload(documents, action) })
    },

    bulkDownload: (documents, options) => client.stream('/api/documents/bulk_download/', {
      method: 'POST',
      json: { documents, content: options.content, compression: options.compression }
    }),

    async task(taskId) {
      const page = await client.request<PaperlessPageDto<PaperlessTaskDto>>('/api/tasks/', { query: { task_id: taskId } })
      const task = page.results.find(candidate => candidate.task_id === taskId)
      if (!task) {
        throw createError({ status: 404, statusText: 'Task not found' })
      }
      return toTask(task)
    },

    async acknowledgeTasks(ids) {
      await client.request('/api/tasks/acknowledge/', { method: 'POST', json: { tasks: ids } })
    },

    listTags: () => listAll<PaperlessTagDto, DocumentsTag>('/api/tags/', toTag),
    createTag: async input => toTag(await client.request<PaperlessTagDto>('/api/tags/', { method: 'POST', json: toTagBody(input) })),
    updateTag: async (id, input) => toTag(await client.request<PaperlessTagDto>(`/api/tags/${id}/`, { method: 'PATCH', json: toTagBody(input) })),
    removeTag: id => client.request(`/api/tags/${id}/`, { method: 'DELETE' }).then(() => undefined),

    listCorrespondents: () => listAll<PaperlessCorrespondentDto, DocumentsCorrespondent>('/api/correspondents/', toCorrespondent),
    createCorrespondent: async input => toCorrespondent(await client.request<PaperlessCorrespondentDto>('/api/correspondents/', { method: 'POST', json: toCorrespondentBody(input) })),
    updateCorrespondent: async (id, input) => toCorrespondent(await client.request<PaperlessCorrespondentDto>(`/api/correspondents/${id}/`, { method: 'PATCH', json: toCorrespondentBody(input) })),
    removeCorrespondent: id => client.request(`/api/correspondents/${id}/`, { method: 'DELETE' }).then(() => undefined),

    listDocumentTypes: () => listAll<PaperlessDocumentTypeDto, DocumentsDocumentType>('/api/document_types/', toDocumentType),
    createDocumentType: async input => toDocumentType(await client.request<PaperlessDocumentTypeDto>('/api/document_types/', { method: 'POST', json: toDocumentTypeBody(input) })),
    updateDocumentType: async (id, input) => toDocumentType(await client.request<PaperlessDocumentTypeDto>(`/api/document_types/${id}/`, { method: 'PATCH', json: toDocumentTypeBody(input) })),
    removeDocumentType: id => client.request(`/api/document_types/${id}/`, { method: 'DELETE' }).then(() => undefined),

    listStoragePaths: () => listAll<PaperlessStoragePathDto, DocumentsStoragePath>('/api/storage_paths/', toStoragePath),
    createStoragePath: async input => toStoragePath(await client.request<PaperlessStoragePathDto>('/api/storage_paths/', { method: 'POST', json: toStoragePathBody(input) })),
    updateStoragePath: async (id, input) => toStoragePath(await client.request<PaperlessStoragePathDto>(`/api/storage_paths/${id}/`, { method: 'PATCH', json: toStoragePathBody(input) })),
    removeStoragePath: id => client.request(`/api/storage_paths/${id}/`, { method: 'DELETE' }).then(() => undefined),

    listCustomFields: () => listAll<PaperlessCustomFieldDto, DocumentsCustomField>('/api/custom_fields/', toCustomField),
    createCustomField: async input => toCustomField(await client.request<PaperlessCustomFieldDto>('/api/custom_fields/', { method: 'POST', json: toCustomFieldBody(input) })),
    updateCustomField: async (id, input) => toCustomField(await client.request<PaperlessCustomFieldDto>(`/api/custom_fields/${id}/`, { method: 'PATCH', json: toCustomFieldBody(input) })),
    removeCustomField: id => client.request(`/api/custom_fields/${id}/`, { method: 'DELETE' }).then(() => undefined),

    listSavedViews: () => listAll<PaperlessSavedViewDto, DocumentsSavedView>('/api/saved_views/', toSavedView),
    createSavedView: async input => toSavedView(await client.request<PaperlessSavedViewDto>('/api/saved_views/', { method: 'POST', json: toSavedViewBody(input) })),
    updateSavedView: async (id, input) => toSavedView(await client.request<PaperlessSavedViewDto>(`/api/saved_views/${id}/`, { method: 'PATCH', json: toSavedViewBody(input) })),
    removeSavedView: id => client.request(`/api/saved_views/${id}/`, { method: 'DELETE' }).then(() => undefined)
  }
}

/** Verifies the instance and token, e.g. when the service is saved. */
export async function testPaperlessConnection(values: SetupValues): Promise<void> {
  const client = createPaperlessClient({ url: String(values.url ?? ''), token: String(values.token ?? '') })
  await client.request('/api/documents/', { query: { page_size: 1 } })
}
