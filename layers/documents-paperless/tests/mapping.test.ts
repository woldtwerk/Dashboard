import { describe, expect, it } from 'vitest'
import { EMPTY_DOCUMENTS_FILTERS } from '../../documents/shared/types/documents'
import type { DocumentsFilters } from '../../documents/shared/types/documents'
import { toCorrespondent, toCustomField, toDocument, toDocumentPatch, toMetadata, toSavedView, toSavedViewBody, toStoragePath, toTag, toTask } from '../server/paperless/mapping'
import type { PaperlessDocumentDto } from '../server/paperless/mapping'

const documentDto: PaperlessDocumentDto = {
  id: 1,
  title: 'Rechnung 2026',
  created: '2026-03-15',
  added: '2026-10-16T19:07:08.538821+02:00',
  modified: '2026-10-16T19:07:08.613054+02:00',
  correspondent: 1,
  document_type: 2,
  storage_path: 3,
  tags: [1, 2],
  archive_serial_number: 42,
  original_file_name: 'test.pdf',
  archived_file_name: '2026-03-15 ACME Rechnung.pdf',
  mime_type: 'application/pdf',
  page_count: 1,
  custom_fields: [{ field: 9, value: '1234.56' }],
  notes: [{ id: 3, note: 'hello', created: '2026-10-16T19:07:27Z', user: { id: 2, username: 'admin', first_name: 'Willi', last_name: 'Woldt' } }],
  owner: 2
}

describe('toDocument', () => {
  it('maps snake_case fields and nested values', () => {
    const document = toDocument(documentDto)
    expect(document).toMatchObject({
      id: 1,
      title: 'Rechnung 2026',
      created: '2026-03-15',
      documentType: 2,
      storagePath: 3,
      archiveSerialNumber: 42,
      originalFileName: 'test.pdf',
      archivedFileName: '2026-03-15 ACME Rechnung.pdf',
      mimeType: 'application/pdf',
      pageCount: 1,
      tags: [1, 2],
      customFields: [{ field: 9, value: '1234.56' }]
    })
    expect(document.notes?.[0]).toMatchObject({ id: 3, note: 'hello', user: { username: 'admin', firstName: 'Willi' } })
  })

  it('defaults missing lists', () => {
    const sparse = { ...documentDto, tags: undefined as unknown as number[], custom_fields: undefined, notes: undefined }
    expect(toDocument(sparse).tags).toEqual([])
    expect(toDocument(sparse).customFields).toEqual([])
  })
})

describe('taxonomy mapping', () => {
  it('maps tags, correspondents, storage paths and custom fields', () => {
    expect(toTag({ id: 1, name: 'Inbox', slug: 'inbox', color: '#ff0000', matching_algorithm: 1, is_inbox_tag: true, document_count: 3 })).toMatchObject({
      id: 1, name: 'Inbox', color: '#ff0000', matchingAlgorithm: 1, isInboxTag: true, documentCount: 3
    })
    expect(toCorrespondent({ id: 2, name: 'ACME', slug: 'acme', matching_algorithm: 2, document_count: 5 })).toMatchObject({ id: 2, name: 'ACME', matchingAlgorithm: 2, documentCount: 5 })
    expect(toStoragePath({ id: 3, name: 'Invoices', slug: 'invoices', path: 'invoices/{{ created_year }}', document_count: 1 })).toMatchObject({ id: 3, path: 'invoices/{{ created_year }}' })
    expect(toCustomField({ id: 9, name: 'Amount', data_type: 'monetary', document_count: 1 })).toMatchObject({ id: 9, dataType: 'monetary' })
  })
})

describe('toDocumentPatch', () => {
  it('only includes the fields that are set and renames them', () => {
    expect(toDocumentPatch({ title: 'New', documentType: 4, archiveSerialNumber: null, customFields: [{ field: 9, value: 1 }] })).toEqual({
      title: 'New',
      document_type: 4,
      archive_serial_number: null,
      custom_fields: [{ field: 9, value: 1 }]
    })
  })
})

describe('toMetadata', () => {
  it('maps the metadata fields', () => {
    expect(toMetadata({
      original_checksum: 'a',
      original_size: 10,
      original_mime_type: 'application/pdf',
      has_archive_version: true,
      archive_checksum: 'b',
      archive_size: 20,
      original_filename: 'test.pdf',
      archive_filename: 'archived.pdf'
    })).toEqual({
      originalChecksum: 'a',
      originalSize: 10,
      originalMimeType: 'application/pdf',
      hasArchiveVersion: true,
      archiveChecksum: 'b',
      archiveSize: 20,
      originalFilename: 'test.pdf',
      archiveFilename: 'archived.pdf'
    })
  })
})

describe('toTask', () => {
  it('maps a task and normalizes an unknown status', () => {
    expect(toTask({ id: 4, task_id: 't', task_type: 'consume_file', status: 'success', related_document_ids: [1], acknowledged: false, date_created: 'x' })).toMatchObject({
      id: 4, taskId: 't', taskType: 'consume_file', status: 'success', relatedDocuments: [1]
    })
    expect(toTask({ id: 4, task_id: 't', task_type: 'x', status: 'bogus', acknowledged: false, date_created: 'x' }).status).toBe('pending')
  })
})

describe('saved views', () => {
  const filters: DocumentsFilters = { ...structuredClone(EMPTY_DOCUMENTS_FILTERS), tags: [1, 2], correspondent: 4 }

  it('builds an API body from domain filters, omitting unset optionals', () => {
    expect(toSavedViewBody({ name: 'Recent', reverse: true, sort: 'created', filters })).toEqual({
      name: 'Recent',
      sort_field: 'created',
      sort_reverse: true,
      filter_rules: [{ rule_type: 7, value: '1,2' }, { rule_type: 3, value: '4' }]
    })
  })

  it('resolves API rules back to domain filters', () => {
    const view = toSavedView({ id: 1, name: 'Recent', sort_field: 'created', sort_reverse: true, filter_rules: [{ rule_type: 7, value: '1,2' }, { rule_type: 3, value: '4' }] })
    expect(view.filters.tags).toEqual([1, 2])
    expect(view.filters.correspondent).toBe(4)
    expect(view.sort).toBe('created')
    expect(view.reverse).toBe(true)
    expect(view.rules).toEqual([{ ruleType: 7, value: '1,2' }, { ruleType: 3, value: '4' }])
  })
})
