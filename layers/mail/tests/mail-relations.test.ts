import { describe, expect, it } from 'vitest'
import type { MailMessage } from '../shared/types/mail'
import { mailAddressLabel, mailAddressText, mailRelationKind } from '../server/utils/mail-relations'

const mail = (overrides: Partial<MailMessage> = {}): Pick<MailMessage, 'from' | 'to' | 'cc'> => ({
  from: [{ name: 'Jane Doe', address: 'Jane@Example.com' }],
  to: [{ address: 'me@example.com' }],
  cc: [{ address: 'team@example.com' }],
  ...overrides
})

describe('mailRelationKind', () => {
  it('tells sender, direct recipient and cc apart', () => {
    expect(mailRelationKind(mail(), 'jane@example.com')).toBe('from')
    expect(mailRelationKind(mail(), 'me@example.com')).toBe('to')
    expect(mailRelationKind(mail(), 'team@example.com')).toBe('cc')
  })

  it('prefers the stronger role when a mail carries the address twice', () => {
    expect(mailRelationKind(mail({ to: [{ address: 'jane@example.com' }] }), 'jane@example.com')).toBe('from')
    expect(mailRelationKind(mail({ cc: [{ address: 'me@example.com' }] }), 'me@example.com')).toBe('to')
  })

  it('normalizes both sides and ignores an address that is not on the mail', () => {
    expect(mailRelationKind(mail({ from: [{ address: 'Jane@Example.COM' }] }), ' JANE@example.com ')).toBe('from')
    expect(mailRelationKind(mail(), 'stranger@example.com')).toBeUndefined()
    expect(mailRelationKind(mail(), 'not-an-address')).toBeUndefined()
  })
})

describe('mail address text', () => {
  it('formats names with their address and falls back to whichever exists', () => {
    expect(mailAddressText([{ name: 'Jane', address: 'jane@example.com' }, { name: 'Sales' }, { address: 'x@example.com' }]))
      .toBe('Jane <jane@example.com>, Sales, x@example.com')
  })

  it('labels a person by name, or by address without one', () => {
    expect(mailAddressLabel({ name: ' Jane ', address: 'jane@example.com' }, 'jane@example.com')).toBe('Jane')
    expect(mailAddressLabel({ address: 'jane@example.com' }, 'jane@example.com')).toBe('jane@example.com')
  })
})
