import { describe, expect, it } from 'vitest'
import type { DomainEvent } from '../../core/shared/types/domain-events'
import { contactsRefreshFor } from '../app/utils/contacts-events'

const event = (extra: Partial<DomainEvent> = {}): DomainEvent => ({
  domain: 'contacts',
  service: 'personal',
  type: 'changed',
  at: '2026-10-18T10:00:00.000Z',
  ...extra
})

describe('contactsRefreshFor', () => {
  it('refreshes on a change in the contacts domain', () => {
    expect(contactsRefreshFor(event())).toBe(true)
    expect(contactsRefreshFor(event({ resource: 'https://dav.example/book' }))).toBe(true)
  })

  it('ignores sync status and other domains', () => {
    expect(contactsRefreshFor(event({ type: 'synced' }))).toBe(false)
    expect(contactsRefreshFor(event({ domain: 'mail' }))).toBe(false)
  })
})
