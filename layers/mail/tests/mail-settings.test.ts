import { describe, expect, it } from 'vitest'
import { mailSettingsDefaults, mailSettingsSchema, TRUSTED_IMAGE_SENDERS_MAX } from '../server/utils/mail-settings'

const parse = (value: unknown) => mailSettingsSchema.safeParse(value)

describe('mail settings schema', () => {
  it('has empty trusted senders and the mails view by default', () => {
    expect(mailSettingsDefaults).toEqual({ trustedImageSenders: [], listView: 'mails' })
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
