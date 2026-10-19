import { describe, expect, it } from 'vitest'
import { mailRefreshTooltip } from '../app/utils/mail-refresh'
import type { MailRefreshState } from '../app/utils/mail-refresh'

const state = (extra: Partial<MailRefreshState> = {}): MailRefreshState => ({
  syncing: false,
  indexing: false,
  messages: 0,
  reloading: false,
  ...extra
})

describe('mailRefreshTooltip', () => {
  it('reads "Refresh" when nothing runs', () => {
    expect(mailRefreshTooltip(state())).toBe('Refresh')
  })

  it('names a running sync', () => {
    expect(mailRefreshTooltip(state({ syncing: true, reloading: true }))).toBe('Syncing with the mail server…')
  })

  it('names a running sync even while the index is still built', () => {
    expect(mailRefreshTooltip(state({ syncing: true, indexing: true, messages: 42 }))).toBe('Syncing with the mail server…')
  })

  it('shows the build state with the indexed message count', () => {
    expect(mailRefreshTooltip(state({ indexing: true, messages: 42 })))
      .toBe('Building search index (42 messages). Until then, search goes to the mail server.')
  })

  it('names a reload of the list on screen', () => {
    expect(mailRefreshTooltip(state({ reloading: true }))).toBe('Refreshing…')
  })
})
