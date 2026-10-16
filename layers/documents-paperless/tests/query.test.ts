import { describe, expect, it } from 'vitest'
import { EMPTY_DOCUMENTS_FILTERS } from '../../documents/shared/types/documents'
import type { DocumentsCustomField, DocumentsQuery } from '../../documents/shared/types/documents'
import { customFieldQuery, toPaperlessParams } from '../server/paperless/query'

function query(overrides: Partial<DocumentsQuery> = {}, filters: Partial<DocumentsQuery['filters']> = {}): DocumentsQuery {
  return {
    page: 1,
    pageSize: 25,
    sort: 'added',
    order: 'desc',
    ...overrides,
    filters: { ...structuredClone(EMPTY_DOCUMENTS_FILTERS), ...filters }
  }
}

describe('toPaperlessParams', () => {
  it('maps pagination, search and sort', () => {
    expect(toPaperlessParams(query({ page: 2, pageSize: 25, sort: 'created', order: 'asc', text: 'invoice', moreLikeId: 7 }))).toMatchObject({
      page: '2',
      page_size: '25',
      ordering: 'created',
      query: 'invoice',
      more_like_id: '7'
    })
    expect(toPaperlessParams(query())[`ordering`]).toBe('-added')
  })

  it('maps every filter', () => {
    const params = toPaperlessParams(query({}, {
      tags: [1, 2],
      tagsExcluded: [5],
      correspondent: 4,
      documentType: 6,
      storagePath: 8,
      asn: 42,
      owner: 2,
      inbox: true,
      created: { after: '2026-01-01', before: '2026-02-01' },
      added: { after: '2026-03-01' }
    }))

    expect(params).toMatchObject({
      tags__id__in: '1,2',
      tags__id__none: '5',
      correspondent__id: '4',
      document_type__id: '6',
      storage_path__id: '8',
      archive_serial_number: '42',
      owner__id: '2',
      is_in_inbox: 'true',
      created__date__gte: '2026-01-01',
      created__date__lte: '2026-02-01',
      added__date__gte: '2026-03-01'
    })
  })

  it('uses the "all tags" parameter for the all mode and omits empty filters', () => {
    expect(toPaperlessParams(query({}, { tags: [1, 2], tagsMode: 'all' })).tags__id__all).toBe('1,2')
    expect(toPaperlessParams(query())).not.toHaveProperty('tags__id__in')
    expect(toPaperlessParams(query())).not.toHaveProperty('query')
  })

  it('adds a custom field query when the filter is set and the field resolved', () => {
    const field: DocumentsCustomField = { id: 9, name: 'Amount', dataType: 'monetary', documentCount: 0 }
    const params = toPaperlessParams(query({}, { customField: { field: 9, value: '1234' } }), field)
    expect(params.custom_field_query).toBe(JSON.stringify(['Amount', 'icontains', '1234']))
  })
})

describe('customFieldQuery', () => {
  it('uses icontains for string-like fields', () => {
    const field: DocumentsCustomField = { id: 1, name: 'Customer', dataType: 'string', documentCount: 0 }
    expect(customFieldQuery(field, 'bob')).toBe(JSON.stringify(['Customer', 'icontains', 'bob']))
  })

  it('uses exact with a coerced value for numeric and boolean fields', () => {
    expect(customFieldQuery({ id: 1, name: 'Count', dataType: 'integer', documentCount: 0 }, '3')).toBe(JSON.stringify(['Count', 'exact', 3]))
    expect(customFieldQuery({ id: 1, name: 'Paid', dataType: 'boolean', documentCount: 0 }, 'true')).toBe(JSON.stringify(['Paid', 'exact', true]))
  })

  it('is undefined without a field or value', () => {
    expect(customFieldQuery(undefined, 'x')).toBeUndefined()
    expect(customFieldQuery({ id: 1, name: 'x', dataType: 'string', documentCount: 0 }, undefined)).toBeUndefined()
  })
})
