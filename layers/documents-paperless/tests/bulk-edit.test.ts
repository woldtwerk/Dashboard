import { describe, expect, it } from 'vitest'
import { toBulkEditPayload } from '../server/paperless/bulk-edit'

describe('toBulkEditPayload', () => {
  it('maps tag actions to the tag parameter', () => {
    expect(toBulkEditPayload([1, 2], { method: 'add_tag', tag: 3 })).toEqual({ documents: [1, 2], method: 'add_tag', parameters: { tag: 3 }, from_webui: true })
    expect(toBulkEditPayload([1], { method: 'remove_tag', tag: 3 }).parameters).toEqual({ tag: 3 })
  })

  it('maps metadata setters and their clear (null) form', () => {
    expect(toBulkEditPayload([1], { method: 'set_correspondent', correspondent: 5 }).parameters).toEqual({ correspondent: 5 })
    expect(toBulkEditPayload([1], { method: 'set_document_type', documentType: null }).parameters).toEqual({ document_type: null })
    expect(toBulkEditPayload([1], { method: 'set_storage_path', storagePath: 7 }).parameters).toEqual({ storage_path: 7 })
  })

  it('maps the provider-side actions', () => {
    expect(toBulkEditPayload([1], { method: 'delete' })).toEqual({ documents: [1], method: 'delete', parameters: {}, from_webui: true })
    expect(toBulkEditPayload([1], { method: 'rotate', degrees: 90 }).parameters).toEqual({ degrees: 90 })
    expect(toBulkEditPayload([1, 2], { method: 'merge', metadataDocumentId: 2, deleteOriginals: true }).parameters).toEqual({ metadata_document_id: 2, delete_originals: true })
  })
})
