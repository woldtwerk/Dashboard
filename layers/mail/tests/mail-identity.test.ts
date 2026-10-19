import { describe, expect, it } from 'vitest'
import { senderAddressFor } from '../server/utils/mail-identity'

const own = ['me@example.com', 'alias@example.com']

describe('senderAddressFor', () => {
  it('accepts one of the account\'s own addresses', () => {
    expect(senderAddressFor(own, 'me@example.com', 'alias@example.com')).toEqual({ ok: true, address: 'alias@example.com' })
  })

  it('normalizes the requested address before accepting it', () => {
    expect(senderAddressFor(own, 'me@example.com', 'AlIas@Example.COM')).toEqual({ ok: true, address: 'alias@example.com' })
    expect(senderAddressFor(own, 'me@example.com', 'Alias <alias@example.com>')).toEqual({ ok: true, address: 'alias@example.com' })
  })

  it('rejects an address the account does not own with a 400', () => {
    const result = senderAddressFor(own, 'me@example.com', 'evil@example.com')

    expect(result).toEqual({ ok: false, status: 400, error: 'This account cannot send as evil@example.com' })
  })

  it('rejects a malformed requested address without echoing a line break', () => {
    const result = senderAddressFor(own, 'me@example.com', 'evil@example.com\r\nBcc: x')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).not.toContain('\n')
    }
  })

  it('uses the setup address when none is requested', () => {
    expect(senderAddressFor(own, 'me@example.com')).toEqual({ ok: true, address: 'me@example.com' })
  })

  it('fails with a 500 when the account has no setup address', () => {
    expect(senderAddressFor(own, undefined)).toEqual({ ok: false, status: 500, error: 'The mail account has no sender address' })
  })
})
