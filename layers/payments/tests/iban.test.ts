import { describe, expect, it } from 'vitest'
import { formatIban, isValidIban, normalizeIban } from '../shared/iban'

const DE_IBAN = 'DE89370400440532013000'

describe('isValidIban', () => {
  it('accepts a valid German IBAN with and without spaces', () => {
    expect(isValidIban(DE_IBAN)).toBe(true)
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true)
    expect(isValidIban('de89370400440532013000')).toBe(true)
  })

  it('rejects a single wrong check digit', () => {
    expect(isValidIban('DE89370400440532013001')).toBe(false)
  })

  it.each([
    ['too short', 'DE8937040044053201300'],
    ['letters in the check digits', 'DEXX370400440532013000'],
    ['a space inside the digits only', 'DE89-3704-0044-0532-0130-00']
  ])('rejects %s', (_name, value) => {
    expect(isValidIban(value)).toBe(false)
  })
})

describe('formatIban', () => {
  it('normalizes and groups the value in fours', () => {
    expect(normalizeIban(' de89 3704 0044 0532 0130 00 ')).toBe(DE_IBAN)
    expect(formatIban('DE89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00')
  })
})
