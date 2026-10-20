import { describe, expect, it } from 'vitest'
import { parseMoney } from '../shared/money'

describe('parseMoney', () => {
  it.each([
    ['17,99 €', 1799],
    ['€17.99', 1799],
    ['EUR 1.234,56', 123456],
    ['1,234.56 EUR', 123456],
    ['17.99', 1799],
    ['17,9', 1790],
    ['0,99', 99],
    ['1.234', 123400],
    ['1,234', 123400]
  ])('reads %s as %i cents', (text, expected) => {
    expect(parseMoney(text)).toBe(expected)
  })

  it.each([
    '',
    '   ',
    '0',
    '0,00',
    '-17,99',
    'abc',
    '12,345,67',
    '1.234,567',
    '1234.567',
    '17 € 99'
  ])('rejects %s', (text) => {
    expect(parseMoney(text)).toBeUndefined()
  })
})
