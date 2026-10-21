import { describe, expect, it } from 'vitest'
import { isValidWeroToken, parseWeroQrPayload, weroPaymentUrl } from '../shared/wero'

describe('parseWeroQrPayload', () => {
  it.each([
    ['the payload the app emits', 'https://share.weropay.eu/p/1/c/d6xY21Hybs', 'd6xY21Hybs'],
    ['a payload with an amount', 'https://share.weropay.eu/p/1/c/d6xY21Hybs?a=1000&c=EUR', 'd6xY21Hybs'],
    ['the older s segment', 'https://share.weropay.eu/p/1/s/d6xY21Hybs', 'd6xY21Hybs'],
    ['a trailing slash', 'https://share.weropay.eu/p/1/c/d6xY21Hybs/', 'd6xY21Hybs'],
    ['a longer token', 'https://share.weropay.eu/p/1/c/AbCdEf1234567890abcdef', 'AbCdEf1234567890abcdef']
  ])('extracts the token from %s', (_name, payload, expected) => {
    expect(parseWeroQrPayload(payload)).toBe(expected)
  })

  it.each([
    ['a lookalike host', 'https://share.weropay.eu.evil.com/p/1/c/d6xY21Hybs'],
    ['another host', 'https://evil.example/p/1/c/d6xY21Hybs'],
    ['another path on the right host', 'https://share.weropay.eu/p/1/d6xY21Hybs'],
    ['a non-default port', 'https://share.weropay.eu:8443/p/1/c/d6xY21Hybs'],
    ['an http payload', 'http://share.weropay.eu/p/1/c/d6xY21Hybs'],
    ['a javascript payload', 'javascript:alert(1)'],
    ['a data payload', 'data:text/plain,d6xY21Hybs'],
    ['a token of an impossible length', 'https://share.weropay.eu/p/1/c/short'],
    ['text that is not a URL', 'just some text']
  ])('rejects %s', (_name, payload) => {
    expect(parseWeroQrPayload(payload)).toBe('')
  })
})

describe('isValidWeroToken', () => {
  it.each([
    ['a token', 'd6xY21Hybs', true],
    ['a legacy phone alias', '+49 170 1234567', false],
    ['a legacy email alias', 'jane@example.com', false]
  ])('reads %s', (_name, value, expected) => {
    expect(isValidWeroToken(value)).toBe(expected)
  })
})

describe('weroPaymentUrl', () => {
  it('builds a link with the amount in whole cents', () => {
    expect(weroPaymentUrl('d6xY21Hybs', 1000)).toBe('https://share.weropay.eu/p/1/c/d6xY21Hybs?a=1000&c=EUR')
  })

  it('leaves the amount off when none is given', () => {
    expect(weroPaymentUrl('d6xY21Hybs')).toBe('https://share.weropay.eu/p/1/c/d6xY21Hybs')
  })

  it('refuses a token a Wero link cannot carry', () => {
    expect(() => weroPaymentUrl('jane@example.com', 1000)).toThrow()
  })
})
