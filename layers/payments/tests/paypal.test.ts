import { describe, expect, it } from 'vitest'
import { paypalMeLink } from '../shared/paypal'

describe('paypalMeLink', () => {
  it('builds the link with a dot and two decimals', () => {
    expect(paypalMeLink('maxmustermann', 1799)).toBe('https://paypal.me/maxmustermann/17.99EUR')
    expect(paypalMeLink('MaxMuster2', 5)).toBe('https://paypal.me/MaxMuster2/0.05EUR')
  })

  it.each([
    ['an empty username', ''],
    ['a dash', 'max-mustermann'],
    ['a space', 'max mustermann'],
    ['more than 20 characters', 'a'.repeat(21)]
  ])('rejects %s', (_name, username) => {
    expect(() => paypalMeLink(username, 100)).toThrow()
  })

  it('rejects a zero amount', () => {
    expect(() => paypalMeLink('max', 0)).toThrow()
  })
})
