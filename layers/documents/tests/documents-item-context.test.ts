import { describe, expect, it } from 'vitest'
import type { DocumentsDocument } from '../shared/types/documents'
import { documentsItemContext } from '../app/utils/documents-item-context'

const document = (overrides: Partial<DocumentsDocument> = {}): DocumentsDocument => ({
  id: 7,
  title: 'Invoice',
  created: '2026-01-01',
  added: '2026-01-01T00:00:00Z',
  modified: '2026-01-01T00:00:00Z',
  correspondent: 3,
  documentType: 4,
  storagePath: null,
  tags: [1, 2],
  archiveSerialNumber: null,
  originalFileName: null,
  archivedFileName: null,
  mimeType: 'application/pdf',
  pageCount: null,
  customFields: [],
  owner: null,
  ...overrides
})

describe('documentsItemContext', () => {
  it('describes the document for other layers item actions', () => {
    const context = documentsItemContext(document(), 'documents-1', {
      tag: id => ({ 1: 'Tax', 2: 'Inbox' })[id],
      correspondent: id => id === 3 ? 'ACME' : undefined,
      documentType: id => id === 4 ? 'Invoice' : undefined
    })

    expect(context).toEqual({
      domain: 'documents',
      service: 'documents-1',
      ref: 'document:documents-1:7',
      item: {
        title: 'Invoice',
        correspondent: 'ACME',
        documentType: 'Invoice',
        tags: ['Tax', 'Inbox']
      }
    })
  })

  it('leaves names out when the document has none', () => {
    const context = documentsItemContext(document({ correspondent: null, documentType: null, tags: [] }), 'documents-1')

    expect(context.item).toEqual({
      title: 'Invoice',
      correspondent: undefined,
      documentType: undefined,
      tags: []
    })
  })
})
