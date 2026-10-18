import { describe, expect, it } from 'vitest'
import type { DomainEvent } from '../../core/shared/types/domain-events'
import { driveRefreshFor } from '../app/utils/drive-events'

const event = (extra: Partial<DomainEvent> = {}): DomainEvent => ({
  domain: 'drive',
  service: 'proton',
  type: 'changed',
  at: '2026-10-18T10:00:00.000Z',
  ...extra
})

describe('driveRefreshFor', () => {
  it('refreshes the folder whose listing changed', () => {
    expect(driveRefreshFor(event({ resource: '/my-files' }), '/my-files')).toBe(true)
    expect(driveRefreshFor(event({ resource: '/my-files' }), '/my-files/Work')).toBe(false)
  })

  it('refreshes any folder when the event names no resource', () => {
    expect(driveRefreshFor(event(), '/my-files/Work')).toBe(true)
  })

  it('ignores sync status and other domains', () => {
    expect(driveRefreshFor(event({ type: 'synced' }), '/my-files')).toBe(false)
    expect(driveRefreshFor(event({ domain: 'documents' }), '/my-files')).toBe(false)
  })
})
