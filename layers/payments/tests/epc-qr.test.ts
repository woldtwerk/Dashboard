import { describe, expect, it } from 'vitest'
import { epcQrPayload } from '../shared/epc-qr'

const IBAN = 'DE89370400440532013000'

describe('epcQrPayload', () => {
  it('builds the full payload with a BIC', () => {
    const payload = epcQrPayload({
      name: 'Max Mustermann',
      iban: IBAN,
      bic: 'COBADEFFXXX',
      amountCents: 1234,
      remittance: 'AM-7K3Q9X'
    })

    expect(payload).toBe([
      'BCD',
      '002',
      '1',
      'SCT',
      'COBADEFFXXX',
      'Max Mustermann',
      IBAN,
      'EUR12.34',
      '',
      '',
      'AM-7K3Q9X'
    ].join('\n'))
  })

  it('keeps the BIC line in place when there is none', () => {
    const payload = epcQrPayload({
      name: 'Anna',
      iban: IBAN,
      amountCents: 1799,
      remittance: 'AM-AAAAAA'
    })

    expect(payload).toBe([
      'BCD',
      '002',
      '1',
      'SCT',
      '',
      'Anna',
      IBAN,
      'EUR17.99',
      '',
      '',
      'AM-AAAAAA'
    ].join('\n'))
  })

  it('truncates the name and the remittance to their limits', () => {
    const lines = epcQrPayload({
      name: 'x'.repeat(80),
      iban: IBAN,
      amountCents: 100,
      remittance: 'y'.repeat(200)
    }).split('\n')

    expect(lines[5]).toBe('x'.repeat(70))
    expect(lines[10]).toBe('y'.repeat(140))
  })

  it('leaves out an empty remittance, without a trailing empty line', () => {
    const payload = epcQrPayload({ name: 'Anna', iban: IBAN, amountCents: 100, remittance: '   ' })

    expect(payload.endsWith('\n')).toBe(false)
    expect(payload.split('\n')).toHaveLength(8)
  })

  it('flattens line breaks so they cannot add payload lines', () => {
    const payload = epcQrPayload({
      name: 'Anna\nEUR999.99',
      iban: IBAN,
      amountCents: 100,
      remittance: 'AM-AAAAAA\nBCD'
    })

    expect(payload.split('\n')).toHaveLength(11)
    expect(payload).toContain('Anna EUR999.99')
    expect(payload).toContain('AM-AAAAAA BCD')
  })

  it.each([
    { name: 'an invalid IBAN', input: { iban: 'DE89370400440532013001' } },
    { name: 'a zero amount', input: { amountCents: 0 } },
    { name: 'a negative amount', input: { amountCents: -100 } },
    { name: 'a fractional amount', input: { amountCents: 100.5 } },
    { name: 'an amount above the EPC maximum', input: { amountCents: 99_999_999_999 + 1 } },
    { name: 'an empty payee name', input: { name: '   ' } },
    { name: 'a malformed BIC', input: { bic: 'COBADEFFX' } }
  ])('rejects $name', ({ input }) => {
    expect(() => epcQrPayload({
      name: 'Anna',
      iban: IBAN,
      amountCents: 100,
      remittance: 'AM-AAAAAA',
      ...input
    })).toThrow()
  })
})
