import type {
  DocumentsDateRange,
  DocumentsFilters,
  DocumentsQuery,
  DocumentsSortField,
  DocumentsTagMode,
  DocumentsView
} from './types/documents'
import { EMPTY_DOCUMENTS_FILTERS } from './types/documents'

export const DOCUMENTS_SORT_FIELDS: DocumentsSortField[] = [
  'added', 'created', 'modified', 'title', 'correspondent',
  'document_type', 'storage_path', 'archive_serial_number', 'id', 'page_count', 'score'
]

export const DEFAULT_PAGE_SIZE = 50
export const DEFAULT_SORT: DocumentsSortField = 'added'
export const DEFAULT_ORDER: 'asc' | 'desc' = 'desc'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** A positive integer, or undefined for anything else. */
export function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    return undefined
  }
  const parsed = Number(value)
  return parsed > 0 ? parsed : undefined
}

/** A non-negative integer (ids may be 0 in dumps), or undefined. */
function parseNonNegativeInt(value: unknown): number | undefined {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value)
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value
  }
  return undefined
}

/** A comma-separated list of ids, e.g. `3,7,12`. */
export function parseIdList(value: unknown): number[] {
  if (typeof value !== 'string') {
    return []
  }
  return value.split(',')
    .map(item => parseNonNegativeInt(item.trim()))
    .filter((item): item is number => item !== undefined)
}

/** A `YYYY-MM-DD` date, or undefined for anything else (no loose parsing). */
export function parseDate(value: unknown): string | undefined {
  return typeof value === 'string' && DATE_PATTERN.test(value) ? value : undefined
}

function dateRangeFromUrl(query: Record<string, unknown>, prefix: string): DocumentsDateRange {
  const after = parseDate(query[`${prefix}After`])
  const before = parseDate(query[`${prefix}Before`])
  return { after, before }
}

function sortFromUrl(value: unknown): DocumentsSortField {
  return typeof value === 'string' && (DOCUMENTS_SORT_FIELDS as string[]).includes(value)
    ? value as DocumentsSortField
    : DEFAULT_SORT
}

function tagsModeFromUrl(value: unknown): DocumentsTagMode {
  return value === 'all' ? 'all' : 'any'
}

/**
 * The list state encoded in the URL. Every value is validated; anything dubious
 * falls back to the default rather than reaching the provider.
 */
export function documentsQueryFromUrl(query: Record<string, unknown>): DocumentsQuery {
  const customFieldId = parseNonNegativeInt(query.field)
  const customFieldValue = typeof query.fieldValue === 'string' && query.fieldValue.trim() ? query.fieldValue.trim() : undefined

  const filters: DocumentsFilters = {
    ...EMPTY_DOCUMENTS_FILTERS,
    tags: parseIdList(query.tags),
    tagsExcluded: parseIdList(query.notTags),
    tagsMode: tagsModeFromUrl(query.tagsMode),
    correspondent: parseNonNegativeInt(query.correspondent),
    documentType: parseNonNegativeInt(query.type),
    storagePath: parseNonNegativeInt(query.path),
    customField: customFieldId !== undefined && customFieldValue !== undefined ? { field: customFieldId, value: customFieldValue } : undefined,
    created: dateRangeFromUrl(query, 'created'),
    added: dateRangeFromUrl(query, 'added'),
    asn: parseNonNegativeInt(query.asn),
    owner: parseNonNegativeInt(query.owner),
    inbox: query.inbox === '1'
  }

  const text = typeof query.q === 'string' && query.q.trim() ? query.q.trim() : undefined

  return {
    page: parsePositiveInt(query.page) ?? 1,
    pageSize: parsePositiveInt(query.size) ?? DEFAULT_PAGE_SIZE,
    sort: sortFromUrl(query.sort),
    order: query.order === 'asc' ? 'asc' : DEFAULT_ORDER,
    text,
    moreLikeId: parsePositiveInt(query.mlt),
    filters
  }
}

const idListValue = (ids: number[]): string | null => ids.length ? ids.join(',') : null

const dateValue = (date?: string): string | null => date ?? null

/**
 * The URL query for a list state. Defaults come back as `null` so the caller can
 * overwrite the previous URL key instead of leaving a stale value behind.
 */
export function documentsQueryToUrl(state: DocumentsQuery): Record<string, string | null> {
  const { filters } = state
  const customField = filters.customField

  return {
    page: state.page === 1 ? null : String(state.page),
    size: state.pageSize === DEFAULT_PAGE_SIZE ? null : String(state.pageSize),
    sort: state.sort === DEFAULT_SORT ? null : state.sort,
    order: state.order === DEFAULT_ORDER ? null : 'asc',
    q: state.text ?? null,
    mlt: state.moreLikeId ? String(state.moreLikeId) : null,
    tags: idListValue(filters.tags),
    notTags: idListValue(filters.tagsExcluded),
    tagsMode: filters.tagsMode === 'any' ? null : 'all',
    correspondent: filters.correspondent === undefined ? null : String(filters.correspondent),
    type: filters.documentType === undefined ? null : String(filters.documentType),
    path: filters.storagePath === undefined ? null : String(filters.storagePath),
    field: customField?.field === undefined ? null : String(customField.field),
    fieldValue: customField?.value ?? null,
    createdAfter: dateValue(filters.created.after),
    createdBefore: dateValue(filters.created.before),
    addedAfter: dateValue(filters.added.after),
    addedBefore: dateValue(filters.added.before),
    asn: filters.asn === undefined ? null : String(filters.asn),
    owner: filters.owner === undefined ? null : String(filters.owner),
    inbox: filters.inbox ? '1' : null
  }
}

export function documentsViewFromUrl(value: unknown): DocumentsView {
  return value === 'grid' ? 'grid' : 'table'
}

export function documentsViewToUrl(view: DocumentsView): string | null {
  return view === 'table' ? null : 'grid'
}

/** Whether any filter is set, e.g. to show a "filters active" badge. */
export function hasActiveFilters(filters: DocumentsFilters): boolean {
  return filters.tags.length > 0
    || filters.tagsExcluded.length > 0
    || filters.correspondent !== undefined
    || filters.documentType !== undefined
    || filters.storagePath !== undefined
    || filters.customField !== undefined
    || filters.created.after !== undefined || filters.created.before !== undefined
    || filters.added.after !== undefined || filters.added.before !== undefined
    || filters.asn !== undefined
    || filters.owner !== undefined
    || filters.inbox
}

/** Replaces only the filter fields, keeping pagination/sort, and resets to page 1. */
export function withFilters(state: DocumentsQuery, filters: DocumentsFilters): DocumentsQuery {
  return { ...state, page: 1, filters }
}
