import { createError } from 'nuxt/server'
import type { SetupValues } from '../../../core/shared/types/setup'
import type {
  DocumentsBulkAction,
  DocumentsCorrespondent,
  DocumentsCorrespondentInput,
  DocumentsCustomField,
  DocumentsCustomFieldInput,
  DocumentsDocument,
  DocumentsDocumentPatch,
  DocumentsDocumentType,
  DocumentsDocumentTypeInput,
  DocumentsHistoryEntry,
  DocumentsMetadata,
  DocumentsNote,
  DocumentsPage,
  DocumentsQuery,
  DocumentsSavedView,
  DocumentsSavedViewInput,
  DocumentsShareLink,
  DocumentsStoragePath,
  DocumentsStoragePathInput,
  DocumentsSuggestions,
  DocumentsTag,
  DocumentsTagInput,
  DocumentsTask
} from '../../shared/types/documents'

/** The request stream and its headers, forwarded verbatim to the provider. */
export interface DocumentsUpload {
  stream: ReadableStream<Uint8Array> | null
  contentType?: string
  contentLength?: string
}

export interface DocumentsDownloadOptions {
  /** `true` streams the original file, `false` the archived (OCR) one */
  original: boolean
}

export interface DocumentsBulkDownloadOptions {
  content: 'archive' | 'original' | 'both'
  compression: 'none' | 'deflated'
}

/**
 * Port every document-archive provider adapter implements. Every method takes
 * and returns ids, never provider URLs or credentials, so the domain and the UI
 * stay independent of the backend.
 */
export interface DocumentsProvider {
  list(query: DocumentsQuery): Promise<DocumentsPage<DocumentsDocument>>
  get(id: number): Promise<DocumentsDocument>
  update(id: number, patch: DocumentsDocumentPatch): Promise<DocumentsDocument>
  remove(id: number): Promise<void>

  /**
   * Documents added after an ISO timestamp, newest first; `null` returns the newest
   * documents. The scheduler's safety-net sweep uses it to recover documents that
   * arrived without a domain event (`added__gt` on Paperless).
   */
  listAdded(since: string | null, limit: number): Promise<DocumentsDocument[]>

  /** Number of documents currently in the inbox */
  countInbox(): Promise<number>
  /** Number of documents added in [since, until), dates as YYYY-MM-DD */
  countAdded(since: string, until: string): Promise<number>
  /** Verifies the provider answers, e.g. for the dashboard's service health */
  ping(): Promise<void>

  /** Preview images. Guarded by {@link isInlinePreview} before rendering. */
  thumbnail(id: number): Promise<Response>
  preview(id: number): Promise<Response>
  download(id: number, options: DocumentsDownloadOptions): Promise<Response>
  /** Streams one uploaded file (multipart body) in; returns the provider task id */
  upload(upload: DocumentsUpload): Promise<string>

  metadata(id: number): Promise<DocumentsMetadata>
  suggestions(id: number): Promise<DocumentsSuggestions>
  history(id: number): Promise<DocumentsHistoryEntry[]>

  listNotes(id: number): Promise<DocumentsNote[]>
  addNote(id: number, note: string): Promise<DocumentsNote[]>
  removeNote(id: number, noteId: number): Promise<void>

  listShareLinks(id: number): Promise<DocumentsShareLink[]>
  createShareLink(id: number, options: { expiration?: string | null, fileVersion?: 'archive' | 'original' }): Promise<DocumentsShareLink>
  removeShareLink(id: number, linkId: number): Promise<void>

  bulkEdit(ids: number[], action: DocumentsBulkAction): Promise<void>
  bulkDownload(ids: number[], options: DocumentsBulkDownloadOptions): Promise<Response>

  task(taskId: string): Promise<DocumentsTask>
  acknowledgeTasks(taskIds: number[]): Promise<void>

  listTags(): Promise<DocumentsTag[]>
  createTag(input: DocumentsTagInput): Promise<DocumentsTag>
  updateTag(id: number, input: DocumentsTagInput): Promise<DocumentsTag>
  removeTag(id: number): Promise<void>

  listCorrespondents(): Promise<DocumentsCorrespondent[]>
  createCorrespondent(input: DocumentsCorrespondentInput): Promise<DocumentsCorrespondent>
  updateCorrespondent(id: number, input: DocumentsCorrespondentInput): Promise<DocumentsCorrespondent>
  removeCorrespondent(id: number): Promise<void>

  listDocumentTypes(): Promise<DocumentsDocumentType[]>
  createDocumentType(input: DocumentsDocumentTypeInput): Promise<DocumentsDocumentType>
  updateDocumentType(id: number, input: DocumentsDocumentTypeInput): Promise<DocumentsDocumentType>
  removeDocumentType(id: number): Promise<void>

  listStoragePaths(): Promise<DocumentsStoragePath[]>
  createStoragePath(input: DocumentsStoragePathInput): Promise<DocumentsStoragePath>
  updateStoragePath(id: number, input: DocumentsStoragePathInput): Promise<DocumentsStoragePath>
  removeStoragePath(id: number): Promise<void>

  listCustomFields(): Promise<DocumentsCustomField[]>
  createCustomField(input: DocumentsCustomFieldInput): Promise<DocumentsCustomField>
  updateCustomField(id: number, input: DocumentsCustomFieldInput): Promise<DocumentsCustomField>
  removeCustomField(id: number): Promise<void>

  listSavedViews(): Promise<DocumentsSavedView[]>
  createSavedView(input: DocumentsSavedViewInput): Promise<DocumentsSavedView>
  updateSavedView(id: number, input: DocumentsSavedViewInput): Promise<DocumentsSavedView>
  removeSavedView(id: number): Promise<void>
}

/** Creates a provider from the settings of one service instance, named for logs where known */
export type DocumentsProviderFactory = (values: SetupValues, serviceId?: string) => DocumentsProvider

const providers = new Map<string, DocumentsProviderFactory>()

export function registerDocumentsProvider(connector: string, factory: DocumentsProviderFactory) {
  providers.set(connector, factory)
}

export async function useDocumentsProvider(serviceId: string): Promise<DocumentsProvider> {
  const service = await getService(serviceId, 'documents')
  const factory = providers.get(service.connector)

  if (!factory) {
    throw createError({ status: 503, statusText: `Documents provider "${service.connector}" is not available` })
  }

  return factory(service.values, serviceId)
}
