import type {
  DocumentsCorrespondent,
  DocumentsCorrespondentInput,
  DocumentsCustomField,
  DocumentsCustomFieldInput,
  DocumentsCustomFieldType,
  DocumentsCustomFieldValue,
  DocumentsDocument,
  DocumentsDocumentPatch,
  DocumentsDocumentType,
  DocumentsDocumentTypeInput,
  DocumentsFilterRule,
  DocumentsHistoryEntry,
  DocumentsMetadata,
  DocumentsNote,
  DocumentsPage,
  DocumentsSavedView,
  DocumentsSavedViewInput,
  DocumentsShareLink,
  DocumentsStoragePath,
  DocumentsStoragePathInput,
  DocumentsTag,
  DocumentsTagInput,
  DocumentsTask
} from '../../../documents/shared/types/documents'
import { filtersToRules, rulesToFilters } from './saved-view-rules'
import { fromPaperlessHighlights } from './highlight'

// --- DTOs (the shapes the Paperless-ngx API returns) ----------------------

export interface PaperlessNoteDto {
  id: number
  note: string
  created: string
  user: { id: number, username: string, first_name?: string, last_name?: string }
}

export interface PaperlessSearchHitDto {
  /** Relevance score; only present when the request carried a `query` */
  score?: number
  rank?: number
  /** Excerpt HTML with `<span class="match">` around the matches */
  highlights?: string
  text?: string
  document_id?: number
}

export interface PaperlessDocumentDto {
  id: number
  title: string
  content?: string
  created: string
  added: string
  modified: string
  correspondent: number | null
  document_type: number | null
  storage_path: number | null
  tags: number[]
  archive_serial_number: number | null
  original_file_name: string | null
  archived_file_name: string | null
  mime_type: string
  page_count: number | null
  custom_fields?: { field: number, value: unknown }[]
  notes?: PaperlessNoteDto[]
  owner: number | null
  root_document?: number | null
  /** Relevance metadata Paperless adds to full-text search results */
  __search_hit__?: PaperlessSearchHitDto
}

export interface PaperlessTagDto {
  id: number
  name: string
  slug: string
  color?: string
  text_color?: string
  match?: string
  matching_algorithm?: number
  is_insensitive?: boolean
  is_inbox_tag?: boolean
  document_count?: number
  parent?: number | null
}

export interface PaperlessCorrespondentDto {
  id: number
  name: string
  slug: string
  match?: string
  matching_algorithm?: number
  is_insensitive?: boolean
  document_count?: number
  last_correspondence?: string | null
}

export interface PaperlessDocumentTypeDto {
  id: number
  name: string
  slug: string
  match?: string
  matching_algorithm?: number
  is_insensitive?: boolean
  document_count?: number
}

export interface PaperlessStoragePathDto extends PaperlessDocumentTypeDto {
  path: string
}

export interface PaperlessCustomFieldDto {
  id: number
  name: string
  data_type: string
  extra_data?: unknown
  document_count?: number
}

export interface PaperlessMetadataDto {
  original_checksum: string
  original_size: number
  original_mime_type: string
  has_archive_version: boolean
  archive_checksum?: string
  archive_size?: number
  original_filename: string
  archive_filename?: string
}

export interface PaperlessHistoryDto {
  id: number
  timestamp: string
  action: string
  changes: Record<string, [unknown, unknown]>
  actor?: string | null
}

export interface PaperlessShareLinkDto {
  id: number
  created: string
  expiration?: string | null
  slug: string
  document: number
  document_title: string
  file_version: string
}

export interface PaperlessTaskDto {
  id: number
  task_id: string
  task_type: string
  status: string
  related_document_ids?: number[]
  acknowledged: boolean
  date_created: string
  date_done?: string | null
}

/** A raw Paperless filter rule; the domain's `DocumentsFilterRule` renames `rule_type`. */
export interface PaperlessFilterRuleDto {
  rule_type: number
  value: string | null
}

export interface PaperlessSavedViewDto {
  id: number
  name: string
  icon?: string
  sort_field?: string | null
  sort_reverse?: boolean
  filter_rules?: PaperlessFilterRuleDto[]
  page_size?: number | null
  display_mode?: string | null
}

export interface PaperlessPageDto<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

// --- Mapping --------------------------------------------------------------

function toCustomFieldValue(dto: { field: number, value: unknown }): DocumentsCustomFieldValue {
  const value = dto.value
  return {
    field: dto.field,
    value: typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null
  }
}

export function toNote(dto: PaperlessNoteDto): DocumentsNote {
  return {
    id: dto.id,
    note: dto.note,
    created: dto.created,
    user: {
      id: dto.user.id,
      username: dto.user.username,
      firstName: dto.user.first_name,
      lastName: dto.user.last_name
    }
  }
}

export function toDocument(dto: PaperlessDocumentDto): DocumentsDocument {
  return {
    id: dto.id,
    title: dto.title,
    content: dto.content,
    created: dto.created,
    added: dto.added,
    modified: dto.modified,
    correspondent: dto.correspondent,
    documentType: dto.document_type,
    storagePath: dto.storage_path,
    tags: dto.tags ?? [],
    archiveSerialNumber: dto.archive_serial_number,
    originalFileName: dto.original_file_name,
    archivedFileName: dto.archived_file_name,
    mimeType: dto.mime_type,
    pageCount: dto.page_count,
    customFields: (dto.custom_fields ?? []).map(toCustomFieldValue),
    notes: dto.notes?.map(toNote),
    owner: dto.owner,
    rootDocument: dto.root_document,
    // Full-text results carry the matched excerpt, already marker-tagged
    snippet: fromPaperlessHighlights(dto.__search_hit__?.highlights),
    score: dto.__search_hit__?.score
  }
}

export function toTag(dto: PaperlessTagDto): DocumentsTag {
  return {
    id: dto.id,
    name: dto.name,
    slug: dto.slug,
    color: dto.color,
    textColor: dto.text_color,
    match: dto.match,
    matchingAlgorithm: dto.matching_algorithm ?? 0,
    isInsensitive: dto.is_insensitive,
    isInboxTag: dto.is_inbox_tag,
    documentCount: dto.document_count ?? 0,
    parent: dto.parent
  }
}

export function toCorrespondent(dto: PaperlessCorrespondentDto): DocumentsCorrespondent {
  return {
    id: dto.id,
    name: dto.name,
    slug: dto.slug,
    match: dto.match,
    matchingAlgorithm: dto.matching_algorithm ?? 0,
    isInsensitive: dto.is_insensitive,
    documentCount: dto.document_count ?? 0,
    lastCorrespondence: dto.last_correspondence
  }
}

export function toDocumentType(dto: PaperlessDocumentTypeDto): DocumentsDocumentType {
  return {
    id: dto.id,
    name: dto.name,
    slug: dto.slug,
    match: dto.match,
    matchingAlgorithm: dto.matching_algorithm ?? 0,
    isInsensitive: dto.is_insensitive,
    documentCount: dto.document_count ?? 0
  }
}

export function toStoragePath(dto: PaperlessStoragePathDto): DocumentsStoragePath {
  return { ...toDocumentType(dto), path: dto.path }
}

export function toCustomField(dto: PaperlessCustomFieldDto): DocumentsCustomField {
  return {
    id: dto.id,
    name: dto.name,
    dataType: dto.data_type as DocumentsCustomFieldType,
    extraData: dto.extra_data,
    documentCount: dto.document_count ?? 0
  }
}

export function toMetadata(dto: PaperlessMetadataDto): DocumentsMetadata {
  return {
    originalChecksum: dto.original_checksum,
    originalSize: dto.original_size,
    originalMimeType: dto.original_mime_type,
    hasArchiveVersion: dto.has_archive_version,
    archiveChecksum: dto.archive_checksum,
    archiveSize: dto.archive_size,
    originalFilename: dto.original_filename,
    archiveFilename: dto.archive_filename
  }
}

export function toHistory(dto: PaperlessHistoryDto): DocumentsHistoryEntry {
  return {
    id: dto.id,
    timestamp: dto.timestamp,
    action: dto.action,
    changes: dto.changes,
    actor: dto.actor
  }
}

export function toShareLink(dto: PaperlessShareLinkDto): DocumentsShareLink {
  return {
    id: dto.id,
    created: dto.created,
    expiration: dto.expiration,
    slug: dto.slug,
    document: dto.document,
    documentTitle: dto.document_title,
    fileVersion: dto.file_version === 'original' ? 'original' : 'archive'
  }
}

const TASK_STATUSES: DocumentsTask['status'][] = ['pending', 'started', 'success', 'failure', 'revoked']

export function toTask(dto: PaperlessTaskDto): DocumentsTask {
  return {
    id: dto.id,
    taskId: dto.task_id,
    taskType: dto.task_type,
    status: TASK_STATUSES.includes(dto.status as DocumentsTask['status']) ? dto.status as DocumentsTask['status'] : 'pending',
    relatedDocuments: dto.related_document_ids ?? [],
    acknowledged: dto.acknowledged,
    dateCreated: dto.date_created,
    dateDone: dto.date_done
  }
}

export function toSavedView(dto: PaperlessSavedViewDto): DocumentsSavedView {
  const rules: DocumentsFilterRule[] = (dto.filter_rules ?? []).map(rule => ({ ruleType: rule.rule_type, value: rule.value }))
  return {
    id: dto.id,
    name: dto.name,
    icon: dto.icon,
    sort: dto.sort_field as DocumentsSavedView['sort'],
    reverse: dto.sort_reverse ?? false,
    pageSize: dto.page_size,
    displayMode: dto.display_mode === 'table' || dto.display_mode === 'grid' ? dto.display_mode : null,
    rules,
    filters: rulesToFilters(rules)
  }
}

export function toPage<TDto, TDomain>(dto: PaperlessPageDto<TDto>, page: number, pageSize: number, map: (item: TDto) => TDomain): DocumentsPage<TDomain> {
  return {
    count: dto.count,
    page,
    pageSize,
    results: dto.results.map(map)
  }
}

// --- Domain input -> API body ---------------------------------------------

export function toDocumentPatch(patch: DocumentsDocumentPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (patch.title !== undefined) {
    body.title = patch.title
  }
  if (patch.created !== undefined) {
    body.created = patch.created
  }
  if (patch.correspondent !== undefined) {
    body.correspondent = patch.correspondent
  }
  if (patch.documentType !== undefined) {
    body.document_type = patch.documentType
  }
  if (patch.storagePath !== undefined) {
    body.storage_path = patch.storagePath
  }
  if (patch.tags !== undefined) {
    body.tags = patch.tags
  }
  if (patch.archiveSerialNumber !== undefined) {
    body.archive_serial_number = patch.archiveSerialNumber
  }
  if (patch.customFields !== undefined) {
    body.custom_fields = patch.customFields
  }
  return body
}

function matchBody(input: { name: string, match?: string, matchingAlgorithm?: number, isInsensitive?: boolean }): Record<string, unknown> {
  const body: Record<string, unknown> = { name: input.name }
  if (input.match !== undefined) {
    body.match = input.match
  }
  if (input.matchingAlgorithm !== undefined) {
    body.matching_algorithm = input.matchingAlgorithm
  }
  if (input.isInsensitive !== undefined) {
    body.is_insensitive = input.isInsensitive
  }
  return body
}

export function toTagBody(input: DocumentsTagInput): Record<string, unknown> {
  const body = matchBody(input)
  if (input.color !== undefined) {
    body.color = input.color
  }
  if (input.isInboxTag !== undefined) {
    body.is_inbox_tag = input.isInboxTag
  }
  if (input.parent !== undefined) {
    body.parent = input.parent
  }
  return body
}

export const toCorrespondentBody = (input: DocumentsCorrespondentInput): Record<string, unknown> => matchBody(input)
export const toDocumentTypeBody = (input: DocumentsDocumentTypeInput): Record<string, unknown> => matchBody(input)

export function toStoragePathBody(input: DocumentsStoragePathInput): Record<string, unknown> {
  return { ...matchBody(input), path: input.path }
}

export function toCustomFieldBody(input: DocumentsCustomFieldInput): Record<string, unknown> {
  const body: Record<string, unknown> = { name: input.name, data_type: input.dataType }
  if (input.extraData !== undefined) {
    body.extra_data = input.extraData
  }
  return body
}

export function toSavedViewBody(input: DocumentsSavedViewInput): Record<string, unknown> {
  // Optional fields are omitted rather than sent as null: Paperless rejects nulls here
  const body: Record<string, unknown> = {
    name: input.name,
    sort_reverse: input.reverse,
    filter_rules: filtersToRules(input.filters).map(rule => ({ rule_type: rule.ruleType, value: rule.value }))
  }
  if (input.icon) {
    body.icon = input.icon
  }
  if (input.sort) {
    body.sort_field = input.sort
  }
  if (input.pageSize !== undefined && input.pageSize !== null) {
    body.page_size = input.pageSize
  }
  if (input.displayMode) {
    body.display_mode = input.displayMode
  }
  return body
}
