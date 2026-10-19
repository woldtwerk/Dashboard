import { describe, expect, it } from 'vitest'
import {
  DOCUMENTS_TOOL_SEARCH_LIMIT,
  documentsGetSources,
  documentsSearchInput,
  documentsSearchSources,
  toDocumentsToolQuery
} from '../server/tools'

describe('toDocumentsToolQuery', () => {
  it('maps text, tags, correspondent and dates onto the list query', () => {
    const input = documentsSearchInput.parse({
      query: 'Rechnung',
      tags: [3, 7],
      tagsMode: 'all',
      correspondent: 2,
      documentType: 4,
      createdAfter: '2026-01-01',
      createdBefore: '2026-12-31',
      limit: 5
    })

    expect(toDocumentsToolQuery(input)).toMatchObject({
      page: 1,
      pageSize: 5,
      sort: 'added',
      order: 'desc',
      text: 'Rechnung',
      filters: {
        tags: [3, 7],
        tagsMode: 'all',
        correspondent: 2,
        documentType: 4,
        created: { after: '2026-01-01', before: '2026-12-31' }
      }
    })
  })

  it(`caps the limit at ${DOCUMENTS_TOOL_SEARCH_LIMIT}`, () => {
    expect(documentsSearchInput.parse({}).limit).toBe(10)
    expect(documentsSearchInput.safeParse({ limit: DOCUMENTS_TOOL_SEARCH_LIMIT + 1 }).success).toBe(false)
  })
})

describe('documents tool sources', () => {
  const document = {
    service: 'archive',
    id: 42,
    title: 'Invoice October',
    created: '2026-10-01',
    archiveSerialNumber: 7,
    mimeType: 'application/pdf'
  }

  it('maps a search result to a document card', () => {
    expect(documentsSearchSources({ documents: [document] })).toEqual([{
      kind: 'document',
      title: 'Invoice October',
      subtitle: '#7',
      date: '2026-10-01',
      link: '/documents/42?service=archive'
    }])
  })

  it('leaves out the serial when the document has none', () => {
    const sources = documentsSearchSources({ documents: [{ ...document, archiveSerialNumber: null }] })

    expect(sources[0]).not.toHaveProperty('subtitle')
  })

  it('maps a read document to one card and ignores an unknown output', () => {
    expect(documentsGetSources({ ...document, content: 'text' })).toHaveLength(1)
    expect(documentsGetSources({ error: 'not found' })).toEqual([])
    expect(documentsSearchSources(undefined)).toEqual([])
  })
})
