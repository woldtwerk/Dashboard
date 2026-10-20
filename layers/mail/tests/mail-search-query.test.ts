import { describe, expect, it } from 'vitest'
import { toMailSearch } from '../server/utils/mail-search-query'

describe('toMailSearch', () => {
  it('maps every query field', () => {
    expect(toMailSearch({
      q: 'invoice',
      unread: true,
      flagged: false,
      hasAttachment: true,
      label: 'Invoices',
      notLabel: 'Done',
      since: '2026-10-01',
      before: '2026-10-16',
      from: 'stripe'
    })).toEqual({
      text: 'invoice',
      unread: true,
      flagged: false,
      hasAttachment: true,
      label: 'Invoices',
      notLabel: 'Done',
      since: '2026-10-01',
      before: '2026-10-16',
      from: 'stripe'
    })
  })

  it('leaves absent fields undefined', () => {
    expect(toMailSearch({ q: '', from: '' })).toEqual({
      text: undefined,
      unread: undefined,
      flagged: undefined,
      hasAttachment: undefined,
      label: undefined,
      notLabel: undefined,
      since: undefined,
      before: undefined,
      from: undefined
    })
  })
})
