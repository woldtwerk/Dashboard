import { describe, expect, it } from 'vitest'
import type { DomainEvent } from '../../core/shared/types/domain-events'
import { calendarRefreshFor } from '../app/utils/calendar-refresh'

const event = (extra: Partial<DomainEvent> = {}): DomainEvent => ({
  domain: 'calendar',
  service: 'work',
  type: 'changed',
  at: '2026-10-18T10:00:00.000Z',
  ...extra
})

describe('calendarRefreshFor', () => {
  it('refreshes on changed and synced', () => {
    expect(calendarRefreshFor(event())).toBe(true)
    expect(calendarRefreshFor(event({ type: 'synced' }))).toBe(true)
  })

  it('only switches the spinner off on failure', () => {
    expect(calendarRefreshFor(event({ type: 'sync-failed' }))).toBe(false)
  })

  it('ignores events of other domains', () => {
    expect(calendarRefreshFor(event({ domain: 'mail' }))).toBe(false)
  })
})
