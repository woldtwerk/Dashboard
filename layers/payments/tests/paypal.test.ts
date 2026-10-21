import { describe, expect, it } from 'vitest'
import {
  normalizePaypalHandle,
  parsePaypalQrPayload,
  parsePaypalTarget,
  paypalPaymentUrl
} from '../shared/paypal'

describe('normalizePaypalHandle', () => {
  it.each([
    ['a bare name', 'jane-doe', 'jane-doe'],
    ['an @ prefix', '@jane-doe', 'jane-doe'],
    ['a paypal.me link', 'https://paypal.me/jane-doe', 'jane-doe'],
    ['a paypal.me link with an amount', 'https://www.paypal.me/jane-doe/25/EUR', 'jane-doe']
  ])('reads %s', (_name, input, expected) => {
    expect(normalizePaypalHandle(input)).toBe(expected)
  })
})

describe('parsePaypalQrPayload', () => {
  it.each([
    ['a personal code', 'https://www.paypal.com/qrcodes/p2pqrc/3ZAD8FWS67RUJ', '3ZAD8FWS67RUJ'],
    ['a paypal.me name', 'https://paypal.me/jane-doe', 'jane-doe'],
    ['a paypal.me link with an amount', 'https://paypal.me/jane-doe/25/EUR', 'jane-doe'],
    ['the long paypal.com form', 'https://www.paypal.com/paypalme/jane-doe', 'jane-doe']
  ])('extracts %s', (_name, payload, expected) => {
    expect(parsePaypalQrPayload(payload)).toBe(expected)
  })

  it.each([
    ['a lookalike host', 'https://paypal.me.evil.com/jane-doe'],
    ['another host', 'https://evil.example/paypalme/jane-doe'],
    ['a non-payment path on the right host', 'https://www.paypal.com/checkoutnow?token=abc'],
    ['a non-default port', 'https://paypal.me:8443/jane-doe'],
    ['an http payload', 'http://paypal.me/jane-doe'],
    ['a javascript payload', 'javascript:alert(1)'],
    ['a data payload', 'data:text/plain,jane-doe'],
    ['text that is not a URL', 'just some text'],
    ['a name with a space', 'https://paypal.me/jane%20doe']
  ])('rejects %s', (_name, payload) => {
    expect(parsePaypalQrPayload(payload)).toBe('')
  })
})

describe('parsePaypalTarget', () => {
  it('treats a personal-code id as a code', () => {
    expect(parsePaypalTarget('3ZAD8FWS67RUJ')).toEqual({ kind: 'code', value: '3ZAD8FWS67RUJ' })
  })

  it('treats a dotted name as a handle', () => {
    expect(parsePaypalTarget('jane.doe')).toEqual({ kind: 'handle', value: 'jane.doe' })
  })
})

describe('paypalPaymentUrl', () => {
  it('rebuilds the original link from a personal code, without an amount', () => {
    expect(paypalPaymentUrl('3ZAD8FWS67RUJ', 1799)).toBe('https://www.paypal.com/qrcodes/p2pqrc/3ZAD8FWS67RUJ')
  })

  it.each([
    [100, '1.00'],
    [5, '0.05'],
    [1799, '17.99']
  ])('prefills %i cents as %s EUR for a name', (cents, amount) => {
    expect(paypalPaymentUrl('jane-doe', cents)).toBe(`https://paypal.me/jane-doe/${amount}EUR`)
  })

  it.each([
    ['an arbitrary value', 'javascript:alert(1)'],
    ['a blank value', ''],
    ['a zero amount', 'jane-doe']
  ])('refuses to build a link from %s', (_name, stored) => {
    expect(() => paypalPaymentUrl(stored, 0)).toThrow()
  })
})
