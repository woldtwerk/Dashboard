import { describe, expect, it } from 'vitest'
import type { DomainEvent } from '../../core/shared/types/domain-events'
import { mailRefreshFor } from '../app/utils/mail-events'

const event = (extra: Partial<DomainEvent> = {}): DomainEvent => ({
  domain: 'mail',
  service: 'account',
  type: 'changed',
  at: '2026-10-18T10:00:00.000Z',
  ...extra
})

const current = { service: 'account', mailbox: 'INBOX' }

describe('mailRefreshFor', () => {
  it('refreshes the list of the current mailbox', () => {
    expect(mailRefreshFor(event({ resource: 'INBOX' }), current).list).toBe(true)
    expect(mailRefreshFor(event({ resource: 'Sent' }), current).list).toBe(false)
  })

  it('refreshes the list when the event names no resource', () => {
    expect(mailRefreshFor(event(), current).list).toBe(true)
  })

  it('ignores another account for the list but still refreshes folders', () => {
    const plan = mailRefreshFor(event({ service: 'other', resource: 'INBOX' }), current)

    expect(plan.list).toBe(false)
    expect(plan.folders).toBe(true)
  })

  it('refreshes folders on any mail change', () => {
    expect(mailRefreshFor(event({ resource: 'Sent' }), current).folders).toBe(true)
  })

  it('refreshes the index status when a sync finishes', () => {
    const plan = mailRefreshFor(event({ type: 'synced' }), current)

    expect(plan.indexStatus).toBe(true)
    expect(plan.list).toBe(false)
    expect(plan.folders).toBe(false)
  })

  it('refreshes the index status while folders are indexed', () => {
    expect(mailRefreshFor(event({ resource: 'Sent' }), current).indexStatus).toBe(true)
  })

  it('ignores other domains', () => {
    expect(mailRefreshFor(event({ domain: 'calendar' }), current)).toEqual({
      list: false,
      folders: false,
      indexStatus: false
    })
  })
})
