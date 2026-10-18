/** A tag, e.g. `Inbox`, with its matching rule and colour. */
export interface DocumentsTag {
  id: number
  name: string
  slug: string
  color?: string
  textColor?: string
  match?: string
  matchingAlgorithm: number
  isInsensitive?: boolean
  isInboxTag?: boolean
  documentCount: number
  parent?: number | null
}

export interface DocumentsCorrespondent {
  id: number
  name: string
  slug: string
  match?: string
  matchingAlgorithm: number
  isInsensitive?: boolean
  documentCount: number
  lastCorrespondence?: string | null
}

export interface DocumentsDocumentType {
  id: number
  name: string
  slug: string
  match?: string
  matchingAlgorithm: number
  isInsensitive?: boolean
  documentCount: number
}

export interface DocumentsStoragePath extends DocumentsDocumentType {
  path: string
}

export type DocumentsCustomFieldType
  = 'string' | 'url' | 'date' | 'boolean' | 'integer' | 'float' | 'monetary' | 'documentlink' | 'select' | 'longtext'

export interface DocumentsCustomField {
  id: number
  name: string
  dataType: DocumentsCustomFieldType
  /** e.g. the options of a `select` field */
  extraData?: unknown
  documentCount: number
}

/** One custom field value set on a document. */
export interface DocumentsCustomFieldValue {
  field: number
  value: string | number | boolean | null
}

export interface DocumentsUser {
  id: number
  username: string
  firstName?: string
  lastName?: string
}

export interface DocumentsNote {
  id: number
  note: string
  created: string
  user: DocumentsUser
}

export interface DocumentsVersion {
  id: number
  added: string
  label?: string | null
  checksum?: string
  isRoot?: boolean
}

/** A document as the archive lists and shows it. */
export interface DocumentsDocument {
  id: number
  title: string
  /** Extracted full text; only present where the provider sends it */
  content?: string
  /** Date the document is dated, `YYYY-MM-DD` */
  created: string
  /** ISO 8601 timestamp it was added to the archive */
  added: string
  /** ISO 8601 timestamp of the last change */
  modified: string
  correspondent: number | null
  documentType: number | null
  storagePath: number | null
  tags: number[]
  archiveSerialNumber: number | null
  originalFileName: string | null
  archivedFileName: string | null
  mimeType: string
  pageCount: number | null
  customFields: DocumentsCustomFieldValue[]
  notes?: DocumentsNote[]
  owner: number | null
  rootDocument?: number | null
  versions?: DocumentsVersion[]
  /** Matched excerpt with highlight markers; only on full-text search results */
  snippet?: string
  /** Relevance score; only on full-text search results */
  score?: number
}

/** Fields an edit of a document may change. */
export interface DocumentsDocumentPatch {
  title?: string
  /** `YYYY-MM-DD` */
  created?: string
  correspondent?: number | null
  documentType?: number | null
  storagePath?: number | null
  tags?: number[]
  archiveSerialNumber?: number | null
  customFields?: DocumentsCustomFieldValue[]
}

export interface DocumentsMetadata {
  originalChecksum: string
  originalSize: number
  originalMimeType: string
  hasArchiveVersion: boolean
  archiveChecksum?: string
  archiveSize?: number
  originalFilename: string
  archiveFilename?: string
}

/** What the provider suggests for a document, as one-click chips. */
export interface DocumentsSuggestions {
  correspondents: DocumentsCorrespondent[]
  tags: DocumentsTag[]
  documentTypes: DocumentsDocumentType[]
  storagePaths: DocumentsStoragePath[]
  dates: string[]
}

export interface DocumentsHistoryEntry {
  id: number
  timestamp: string
  action: string
  changes: Record<string, [unknown, unknown]>
  actor?: string | null
}

export interface DocumentsShareLink {
  id: number
  created: string
  expiration?: string | null
  slug: string
  document: number
  documentTitle: string
  fileVersion: 'archive' | 'original'
}

/** A queued background job, e.g. a document being consumed after upload. */
export interface DocumentsTask {
  id: number
  taskId: string
  taskType: string
  status: 'pending' | 'started' | 'success' | 'failure' | 'revoked'
  relatedDocuments: number[]
  acknowledged: boolean
  dateCreated: string
  dateDone?: string | null
}

/** A stored filter rule; `ruleType` is opaque to the domain, its meaning is the provider's. */
export interface DocumentsFilterRule {
  ruleType: number
  value: string | null
}

export interface DocumentsSavedView {
  id: number
  name: string
  icon?: string
  sort?: DocumentsSortField
  reverse: boolean
  pageSize?: number | null
  displayMode?: DocumentsView | null
  /** Raw rules, kept so a view can be saved back losslessly */
  rules: DocumentsFilterRule[]
  /** The same rules resolved to the domain's filters */
  filters: DocumentsFilters
}

/** A page of results, mirroring the provider's pagination. */
export interface DocumentsPage<T> {
  count: number
  page: number
  pageSize: number
  results: T[]
}

// --- Query model ----------------------------------------------------------

export type DocumentsView = 'table' | 'grid'

export type DocumentsSortField
  = | 'created' | 'added' | 'modified' | 'title' | 'correspondent'
    | 'document_type' | 'storage_path' | 'archive_serial_number' | 'id' | 'page_count' | 'score'

export type DocumentsTagMode = 'any' | 'all'

/** An inclusive date range; either bound may be open. `YYYY-MM-DD`. */
export interface DocumentsDateRange {
  after?: string
  before?: string
}

export interface DocumentsFilters {
  tags: number[]
  tagsExcluded: number[]
  tagsMode: DocumentsTagMode
  correspondent?: number
  documentType?: number
  storagePath?: number
  customField?: { field: number, value: string }
  created: DocumentsDateRange
  added: DocumentsDateRange
  asn?: number
  owner?: number
  inbox: boolean
}

/** The whole list state: filters, sort and pagination. */
export interface DocumentsQuery {
  page: number
  pageSize: number
  sort: DocumentsSortField
  order: 'asc' | 'desc'
  text?: string
  moreLikeId?: number
  filters: DocumentsFilters
}

export const EMPTY_DOCUMENTS_FILTERS: DocumentsFilters = {
  tags: [],
  tagsExcluded: [],
  tagsMode: 'any',
  created: {},
  added: {},
  inbox: false
}

// --- Bulk edit ------------------------------------------------------------

export type DocumentsBulkAction
  = | { method: 'add_tag', tag: number }
    | { method: 'remove_tag', tag: number }
    | { method: 'set_correspondent', correspondent: number | null }
    | { method: 'set_document_type', documentType: number | null }
    | { method: 'set_storage_path', storagePath: number | null }
    | { method: 'delete' }
    | { method: 'reprocess' }
    | { method: 'rotate', degrees: number }
    | { method: 'merge', metadataDocumentId?: number | null, deleteOriginals?: boolean }

/** Which ids a bulk operation runs on. */
export interface DocumentsSelection {
  documents: number[]
}

// --- Management inputs ----------------------------------------------------

export interface DocumentsTagInput {
  name: string
  color?: string
  match?: string
  matchingAlgorithm?: number
  isInsensitive?: boolean
  isInboxTag?: boolean
  parent?: number | null
}

export interface DocumentsCorrespondentInput {
  name: string
  match?: string
  matchingAlgorithm?: number
  isInsensitive?: boolean
}

export interface DocumentsDocumentTypeInput {
  name: string
  match?: string
  matchingAlgorithm?: number
  isInsensitive?: boolean
}

export interface DocumentsStoragePathInput extends DocumentsDocumentTypeInput {
  path: string
}

export interface DocumentsCustomFieldInput {
  name: string
  dataType: DocumentsCustomFieldType
  extraData?: unknown
}

export interface DocumentsSavedViewInput {
  name: string
  icon?: string
  sort?: DocumentsSortField
  reverse: boolean
  pageSize?: number | null
  displayMode?: DocumentsView | null
  filters: DocumentsFilters
}
