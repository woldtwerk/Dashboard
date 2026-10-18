import { describe, expect, it } from 'vitest'
import { DOCUMENTS_TOOL_SEARCH_LIMIT, documentsSearchInput, toDocumentsToolQuery } from '../server/tools'

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
