import { describe, expect, it } from 'vitest'
import { applyBulkAction, bulkActionLabel } from '../shared/bulk-edit'
import type { DocumentsDocument } from '../shared/types/documents'

const document = (id: number, tags: number[], correspondent: number | null = null): DocumentsDocument => ({
  id,
  title: `doc ${id}`,
  created: '2026-01-01',
  added: '2026-01-01T00:00:00Z',
  modified: '2026-01-01T00:00:00Z',
  correspondent,
  documentType: null,
  storagePath: null,
  tags,
  archiveSerialNumber: null,
  originalFileName: null,
  archivedFileName: null,
  mimeType: 'application/pdf',
  pageCount: null,
  customFields: [],
  owner: null
})

describe('applyBulkAction', () => {
  const documents = [document(1, [1]), document(2, [2])]

  it('adds a tag to the selected documents only, without duplicating it', () => {
    const result = applyBulkAction(documents, [1], { method: 'add_tag', tag: 9 })
    expect(result[0]!.tags).toEqual([1, 9])
    expect(result[1]!.tags).toEqual([2])

    const again = applyBulkAction(result, [1], { method: 'add_tag', tag: 9 })
    expect(again[0]!.tags).toEqual([1, 9])
  })

  it('removes a tag and sets metadata', () => {
    expect(applyBulkAction(documents, [1, 2], { method: 'remove_tag', tag: 1 })[0]!.tags).toEqual([])
    expect(applyBulkAction(documents, [1, 2], { method: 'set_correspondent', correspondent: 5 })[1]!.correspondent).toBe(5)
  })

  it('deletes the selected documents', () => {
    expect(applyBulkAction(documents, [1], { method: 'delete' }).map(item => item.id)).toEqual([2])
  })

  it('leaves the list unchanged for provider-side actions', () => {
    expect(applyBulkAction(documents, [1], { method: 'reprocess' })).toEqual(documents)
    expect(applyBulkAction(documents, [1], { method: 'rotate', degrees: 90 })).toEqual(documents)
  })
})

describe('bulkActionLabel', () => {
  it('names the target of the action', () => {
    expect(bulkActionLabel({ method: 'add_tag', tag: 3 }, () => 'Inbox')).toBe('Add tag "Inbox"')
    expect(bulkActionLabel({ method: 'set_correspondent', correspondent: null }, id => `#${id}`)).toBe('Clear correspondent')
    expect(bulkActionLabel({ method: 'rotate', degrees: 90 }, () => '')).toBe('Rotate 90°')
  })
})
