import type { DocumentsCustomField, DocumentsCustomFieldType, DocumentsQuery } from '../../../documents/shared/types/documents'
import { DEFAULT_SORT } from '../../../documents/shared/documents-query'

const STRING_TYPES: DocumentsCustomFieldType[] = ['string', 'url', 'monetary', 'longtext']

function customFieldValue(type: DocumentsCustomFieldType, raw: string): string | number | boolean {
  if (type === 'boolean') {
    return raw === 'true' || raw === '1'
  }
  if (type === 'integer') {
    return Number.parseInt(raw, 10) || 0
  }
  if (type === 'float') {
    return Number.parseFloat(raw) || 0
  }
  return raw
}

/**
 * The `custom_field_query` expression for one field, or undefined without a
 * field. String-like fields use a case-insensitive substring match; the rest
 * match exactly, with the value coerced to the field's type.
 */
export function customFieldQuery(field: DocumentsCustomField | undefined, value: string | undefined): string | undefined {
  if (!field || !value) {
    return undefined
  }
  if (STRING_TYPES.includes(field.dataType)) {
    return JSON.stringify([field.name, 'icontains', value])
  }
  return JSON.stringify([field.name, 'exact', customFieldValue(field.dataType, value)])
}

/**
 * The Paperless-ngx query parameters for a domain query. `customField` is the
 * already-resolved field the `customField` filter refers to.
 */
export function toPaperlessParams(query: DocumentsQuery, customField?: DocumentsCustomField): Record<string, string> {
  const params: Record<string, string> = {
    page: String(query.page),
    page_size: String(query.pageSize)
  }

  // A text query is ranked by relevance; only a sort the user picked overrides it
  if (!(query.text && query.sort === DEFAULT_SORT)) {
    params.ordering = `${query.order === 'desc' ? '-' : ''}${query.sort}`
  }

  if (query.text) {
    params.query = query.text
  }
  if (query.moreLikeId) {
    params.more_like_id = String(query.moreLikeId)
  }

  const { filters } = query
  if (filters.tags.length) {
    params[filters.tagsMode === 'all' ? 'tags__id__all' : 'tags__id__in'] = filters.tags.join(',')
  }
  if (filters.tagsExcluded.length) {
    params.tags__id__none = filters.tagsExcluded.join(',')
  }
  if (filters.correspondent !== undefined) {
    params.correspondent__id = String(filters.correspondent)
  }
  if (filters.documentType !== undefined) {
    params.document_type__id = String(filters.documentType)
  }
  if (filters.storagePath !== undefined) {
    params.storage_path__id = String(filters.storagePath)
  }
  if (filters.asn !== undefined) {
    params.archive_serial_number = String(filters.asn)
  }
  if (filters.owner !== undefined) {
    params.owner__id = String(filters.owner)
  }
  if (filters.inbox) {
    params.is_in_inbox = 'true'
  }
  if (filters.created.after) {
    params.created__date__gte = filters.created.after
  }
  if (filters.created.before) {
    params.created__date__lte = filters.created.before
  }
  if (filters.added.after) {
    params.added__date__gte = filters.added.after
  }
  if (filters.added.before) {
    params.added__date__lte = filters.added.before
  }

  const fieldQuery = customFieldQuery(customField, filters.customField?.value)
  if (fieldQuery) {
    params.custom_field_query = fieldQuery
  }

  return params
}
