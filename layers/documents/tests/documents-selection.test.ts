import { describe, expect, it } from 'vitest'
import {
  DOCUMENTS_SELECTION_MAX,
  documentsSelectionFromQuery,
  documentsSelectionToQuery,
  rangeDocumentSelection,
  toggleDocumentSelection
} from '../app/utils/documents-selection'

describe('documentsSelectionToQuery', () => {
  it('joins the ids and is null for an empty selection', () => {
    expect(documentsSelectionToQuery([3, 1, 2])).toBe('3,1,2')
    expect(documentsSelectionToQuery([])).toBeNull()
  })

  it('caps the selection', () => {
    const ids = Array.from({ length: DOCUMENTS_SELECTION_MAX + 5 }, (_, index) => index + 1)

    expect(documentsSelectionFromQuery({ sel: documentsSelectionToQuery(ids) })).toHaveLength(DOCUMENTS_SELECTION_MAX)
  })
})

describe('documentsSelectionFromQuery', () => {
  it('reads ids from the URL', () => {
    expect(documentsSelectionFromQuery({ sel: '3,1,2' })).toEqual([3, 1, 2])
  })

  it('drops malformed ids and duplicates', () => {
    expect(documentsSelectionFromQuery({ sel: '2,nope,-1,0,2,4.5,3' })).toEqual([2, 3])
  })

  it('reads several sel parameters and is empty without one', () => {
    expect(documentsSelectionFromQuery({ sel: ['1', '2,3'] })).toEqual([1, 2, 3])
    expect(documentsSelectionFromQuery({})).toEqual([])
  })
})

describe('toggleDocumentSelection', () => {
  it('adds and removes a document', () => {
    expect(toggleDocumentSelection([], 2)).toEqual([2])
    expect(toggleDocumentSelection([2, 5], 2)).toEqual([5])
  })
})

describe('rangeDocumentSelection', () => {
  const keys = [1, 2, 3, 4]

  it('selects forward and backward', () => {
    expect(rangeDocumentSelection(keys, 2, 4)).toEqual([2, 3, 4])
    expect(rangeDocumentSelection(keys, 4, 2)).toEqual([2, 3, 4])
  })

  it('falls back to the target without a usable anchor', () => {
    expect(rangeDocumentSelection(keys, undefined, 3)).toEqual([3])
    expect(rangeDocumentSelection(keys, 9, 3)).toEqual([3])
  })
})
