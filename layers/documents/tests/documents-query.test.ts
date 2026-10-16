import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_SIZE, DEFAULT_SORT, documentsQueryFromUrl, documentsQueryToUrl, documentsViewFromUrl, documentsViewToUrl, hasActiveFilters, parseDate, parseIdList } from '../shared/documents-query'
import { EMPTY_DOCUMENTS_FILTERS } from '../shared/types/documents'

describe('parseIdList', () => {
  it('reads a comma list of ids', () => {
    expect(parseIdList('3,7,12')).toEqual([3, 7, 12])
    expect(parseIdList('')).toEqual([])
    expect(parseIdList('3, x, 7')).toEqual([3, 7])
    expect(parseIdList(undefined)).toEqual([])
  })
})

describe('parseDate', () => {
  it('only accepts YYYY-MM-DD', () => {
    expect(parseDate('2026-03-15')).toBe('2026-03-15')
    expect(parseDate('2026-3-15')).toBeUndefined()
    expect(parseDate('last week')).toBeUndefined()
  })
})

describe('documentsQueryFromUrl', () => {
  it('reads filters, search and pagination', () => {
    const query = documentsQueryFromUrl({
      q: 'invoice',
      page: '3',
      size: '25',
      sort: 'created',
      order: 'asc',
      mlt: '7',
      tags: '1,2',
      notTags: '5',
      tagsMode: 'all',
      correspondent: '4',
      type: '6',
      path: '8',
      field: '9',
      fieldValue: 'bob',
      createdAfter: '2026-01-01',
      createdBefore: '2026-02-01',
      addedAfter: '2026-03-01',
      asn: '42',
      owner: '2',
      inbox: '1'
    })

    expect(query).toEqual({
      page: 3,
      pageSize: 25,
      sort: 'created',
      order: 'asc',
      text: 'invoice',
      moreLikeId: 7,
      filters: {
        ...EMPTY_DOCUMENTS_FILTERS,
        tags: [1, 2],
        tagsExcluded: [5],
        tagsMode: 'all',
        correspondent: 4,
        documentType: 6,
        storagePath: 8,
        customField: { field: 9, value: 'bob' },
        created: { after: '2026-01-01', before: '2026-02-01' },
        added: { after: '2026-03-01' },
        asn: 42,
        owner: 2,
        inbox: true
      }
    })
  })

  it('falls back to defaults for missing or invalid values', () => {
    const query = documentsQueryFromUrl({ page: '0', size: 'x', sort: 'nope', order: 'sideways', tags: ['1'] })

    expect(query.page).toBe(1)
    expect(query.pageSize).toBe(DEFAULT_PAGE_SIZE)
    expect(query.sort).toBe(DEFAULT_SORT)
    expect(query.order).toBe('desc')
    expect(query.filters.tags).toEqual([])
  })
})

describe('documentsQueryToUrl', () => {
  it('drops defaults so the URL stays clean', () => {
    expect(documentsQueryToUrl({ page: 1, pageSize: DEFAULT_PAGE_SIZE, sort: DEFAULT_SORT, order: 'desc', filters: structuredClone(EMPTY_DOCUMENTS_FILTERS) })).toEqual({
      page: null,
      size: null,
      sort: null,
      order: null,
      q: null,
      mlt: null,
      tags: null,
      notTags: null,
      tagsMode: null,
      correspondent: null,
      type: null,
      path: null,
      field: null,
      fieldValue: null,
      createdAfter: null,
      createdBefore: null,
      addedAfter: null,
      addedBefore: null,
      asn: null,
      owner: null,
      inbox: null
    })
  })

  it('round-trips through the URL', () => {
    const original = documentsQueryFromUrl({ q: 'agenda', tags: '1,2', correspondent: '4', createdAfter: '2026-01-01', order: 'asc', sort: 'title' })
    const url = Object.fromEntries(Object.entries(documentsQueryToUrl(original)).filter(([, value]) => value))

    expect(documentsQueryFromUrl(url)).toEqual(original)
  })
})

describe('document views', () => {
  it('defaults to the table and round-trips the grid', () => {
    expect(documentsViewFromUrl(undefined)).toBe('table')
    expect(documentsViewFromUrl('grid')).toBe('grid')
    expect(documentsViewToUrl('grid')).toBe('grid')
    expect(documentsViewToUrl('table')).toBeNull()
  })
})

describe('hasActiveFilters', () => {
  it('is false for empty filters and true once one is set', () => {
    expect(hasActiveFilters(structuredClone(EMPTY_DOCUMENTS_FILTERS))).toBe(false)
    expect(hasActiveFilters({ ...structuredClone(EMPTY_DOCUMENTS_FILTERS), tags: [1] })).toBe(true)
    expect(hasActiveFilters({ ...structuredClone(EMPTY_DOCUMENTS_FILTERS), created: { after: '2026-01-01' } })).toBe(true)
  })
})
