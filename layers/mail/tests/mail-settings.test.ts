import { describe, expect, it } from 'vitest'
import { mailSettingsDefaults, mailSettingsSchema, TRUSTED_IMAGE_SENDERS_MAX } from '../server/utils/mail-settings'
import { SENDER_ADDRESSES_MAX } from '../shared/mail-sender-addresses'

const parse = (value: unknown) => mailSettingsSchema.safeParse(value)

describe('mail settings schema', () => {
  it('has no trusted senders or manual addresses, the mails view and the Done label by default', () => {
    expect(mailSettingsDefaults).toEqual({ trustedImageSenders: [], listView: 'mails', senderAddresses: {}, doneLabel: 'Done' })
  })

  it('defaults the done label when the stored section predates it', () => {
    const result = parse({ trustedImageSenders: [], listView: 'mails' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.doneLabel).toBe('Done')
    }
  })

  it('rejects a done label that is not a label name', () => {
    expect(parse({ trustedImageSenders: [], listView: 'mails', doneLabel: 'Work/Invoices' }).success).toBe(false)
    expect(parse({ trustedImageSenders: [], listView: 'mails', doneLabel: '  ' }).success).toBe(false)
  })

  it('accepts addresses and domain entries', () => {
    expect(parse({ trustedImageSenders: ['jane@example.com', '@example.com'], listView: 'conversations' }).success).toBe(true)
  })

  it('normalizes every entry on parse', () => {
    const result = parse({
      trustedImageSenders: [' Jane.Doe@Example.COM ', 'Jane Doe <jane@example.com>', ' @Example.COM '],
      listView: 'mails'
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.trustedImageSenders).toEqual(['jane.doe@example.com', 'jane@example.com', '@example.com'])
    }
  })

  it('rejects an invalid entry', () => {
    const result = parse({ trustedImageSenders: ['jane@example.com', 'not-an-address'], listView: 'mails' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('not-an-address')
    }
  })

  it('rejects a domain without a dot', () => {
    expect(parse({ trustedImageSenders: ['@example'], listView: 'mails' }).success).toBe(false)
  })

  it('rejects an unknown list view', () => {
    expect(parse({ trustedImageSenders: [], listView: 'threads' }).success).toBe(false)
  })

  it('accepts the limit and rejects one entry more', () => {
    const entries = (count: number) => Array.from({ length: count }, (_, index) => `sender${index}@example.com`)

    expect(parse({ trustedImageSenders: entries(TRUSTED_IMAGE_SENDERS_MAX), listView: 'mails' }).success).toBe(true)
    expect(parse({ trustedImageSenders: entries(TRUSTED_IMAGE_SENDERS_MAX + 1), listView: 'mails' }).success).toBe(false)
  })
})

describe('manual sender addresses', () => {
  const settings = (senderAddresses: unknown) => ({ trustedImageSenders: [], listView: 'mails', senderAddresses })

  it('defaults to none when the stored section predates the field', () => {
    const result = parse({ trustedImageSenders: [], listView: 'mails' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.senderAddresses).toEqual({})
    }
  })

  it('accepts a list per account and normalizes every address', () => {
    const result = parse(settings({ 'mail-1': [' Alias@Example.COM ', 'Me <me@example.com>'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.senderAddresses).toEqual({ 'mail-1': ['alias@example.com', 'me@example.com'] })
    }
  })

  it('rejects an entry that is not an email address', () => {
    const result = parse(settings({ 'mail-1': ['alias@example.com', 'not-an-address'] }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('not-an-address')
    }
  })

  it('caps the list of one account at the limit', () => {
    const addresses = (count: number) => Array.from({ length: count }, (_, index) => `alias${index}@example.com`)

    expect(parse(settings({ 'mail-1': addresses(SENDER_ADDRESSES_MAX) })).success).toBe(true)
    expect(parse(settings({ 'mail-1': addresses(SENDER_ADDRESSES_MAX + 1) })).success).toBe(false)
  })
})
