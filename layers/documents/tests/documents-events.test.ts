import { describe, expect, it } from 'vitest'
import type { DomainEvent } from '../../core/shared/types/domain-events'
import { documentsRefreshFor } from '../app/utils/documents-events'

const event = (extra: Partial<DomainEvent> = {}): DomainEvent => ({
  domain: 'documents',
  service: 'paperless',
  type: 'changed',
  at: '2026-10-18T10:00:00.000Z',
  ...extra
})

describe('documentsRefreshFor', () => {
  it('refreshes on a change in the documents domain', () => {
    expect(documentsRefreshFor(event())).toBe(true)
    expect(documentsRefreshFor(event({ resource: '42' }))).toBe(true)
  })

  it('ignores sync status and other domains', () => {
    expect(documentsRefreshFor(event({ type: 'synced' }))).toBe(false)
    expect(documentsRefreshFor(event({ domain: 'drive' }))).toBe(false)
  })
})
