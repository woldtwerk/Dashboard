import { describe, expect, it } from 'vitest'
import { EMPTY_DOCUMENTS_FILTERS } from '../../documents/shared/types/documents'
import type { DocumentsFilters } from '../../documents/shared/types/documents'
import { filtersToRules, rulesToFilters } from '../server/paperless/saved-view-rules'

function filters(overrides: Partial<DocumentsFilters> = {}): DocumentsFilters {
  return { ...structuredClone(EMPTY_DOCUMENTS_FILTERS), ...overrides }
}

describe('filtersToRules', () => {
  it('maps each filter to its rule type', () => {
    const rules = filtersToRules(filters({
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

    expect(rules).toEqual([
      { ruleType: 7, value: '1,2' },
      { ruleType: 17, value: '5' },
      { ruleType: 3, value: '4' },
      { ruleType: 4, value: '6' },
      { ruleType: 25, value: '8' },
      { ruleType: 2, value: '42' },
      { ruleType: 32, value: '2' },
      { ruleType: 5, value: 'true' },
      { ruleType: 9, value: '2026-01-01' },
      { ruleType: 8, value: '2026-02-01' },
      { ruleType: 14, value: '2026-03-01' }
    ])
  })

  it('uses the "has tag" rule for the all mode', () => {
    expect(filtersToRules(filters({ tags: [1, 2], tagsMode: 'all' }))).toEqual([{ ruleType: 6, value: '1,2' }])
  })

  it('produces no rules for empty filters', () => {
    expect(filtersToRules(filters())).toEqual([])
  })
})

describe('rulesToFilters', () => {
  it('round-trips the supported filters', () => {
    const original = filters({
      tags: [1, 2],
      tagsMode: 'all',
      tagsExcluded: [5],
      correspondent: 4,
      documentType: 6,
      storagePath: 8,
      asn: 42,
      owner: 2,
      inbox: true,
      created: { after: '2026-01-01', before: '2026-02-01' },
      added: { after: '2026-03-01', before: '2026-04-01' }
    })

    expect(rulesToFilters(filtersToRules(original))).toEqual(original)
  })

  it('ignores rules it does not understand', () => {
    expect(rulesToFilters([{ ruleType: 999, value: 'x' }])).toEqual(filters())
  })
})
