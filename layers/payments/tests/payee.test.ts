import { describe, expect, it } from 'vitest'
import { createPayeeConnector } from '../server/payee/connector'
import { payeeFromValues } from '../shared/payee'

const service = 'mail-1'
const holder = 'Max Mustermann'

describe('payeeFromValues', () => {
  it('maps the old paypalMe key to paypal', () => {
    expect(payeeFromValues({ holder, mailService: service, paypalMe: 'maxmustermann' }).paypal).toBe('maxmustermann')
  })

  it('drops a legacy free-text Wero alias and keeps a real token', () => {
    expect(payeeFromValues({ holder, mailService: service, wero: '+49 170 1234567' }).wero).toBeUndefined()
    expect(payeeFromValues({ holder, mailService: service, wero: 'd6xY21Hybs' }).wero).toBe('d6xY21Hybs')
  })

  it('keeps a BIC only together with an IBAN', () => {
    const withIban = payeeFromValues({ holder, mailService: service, iban: 'DE89 3704 0044 0532 0130 00', bic: 'cobadeffxxx' })

    expect(withIban.iban).toBe('DE89370400440532013000')
    expect(withIban.bic).toBe('COBADEFFXXX')
    expect(payeeFromValues({ holder, mailService: service, bic: 'COBADEFFXXX' }).bic).toBeUndefined()
  })

  it.each([
    {
      branch: 'lower-cases a comma-separated list',
      paypalEmails: 'Max@Example.com, max.mustermann@example.org',
      expected: ['max@example.com', 'max.mustermann@example.org']
    },
    {
      branch: 'drops a value that is not an email address',
      paypalEmails: 'max@example.com, nicht-ich',
      expected: ['max@example.com']
    }
  ])('$branch', ({ paypalEmails, expected }) => {
    expect(payeeFromValues({ holder, mailService: service, paypalEmails }).paypalEmails).toEqual(expected)
  })
})

describe('payee connector validation', () => {
  const connector = createPayeeConnector()
  const validate = (values: Record<string, string>) => connector.validate?.({ ...values, holder, mailService: service })

  it('accepts an IBAN on its own', () => {
    expect(validate({ iban: 'DE89370400440532013000' })).toBeUndefined()
  })

  it('accepts a PayPal name on its own', () => {
    expect(validate({ paypal: 'maxmustermann' })).toBeUndefined()
  })

  it('accepts a Wero token on its own', () => {
    expect(validate({ wero: 'd6xY21Hybs' })).toBeUndefined()
  })

  it('requires at least one payment method', () => {
    expect(validate({})).toBeTruthy()
  })

  it('rejects a malformed IBAN', () => {
    expect(validate({ iban: 'DE89370400440532013001' })).toBeTruthy()
  })

  it('rejects a PayPal value that is neither a name nor a code', () => {
    expect(validate({ iban: 'DE89370400440532013000', paypal: 'jane doe' })).toBeTruthy()
  })

  it('rejects a Wero value that is not a share token', () => {
    expect(validate({ iban: 'DE89370400440532013000', wero: '+49 170 1234567' })).toBeTruthy()
  })

  it('rejects a PayPal address that is not an email address', () => {
    expect(validate({ paypal: 'maxmustermann', paypalEmails: 'max@example' })).toBeTruthy()
  })
})

describe('payee connector completion', () => {
  const connector = createPayeeConnector()

  it('normalizes a pasted PayPal link and drops a BIC without an IBAN', async () => {
    const values = await connector.complete?.({
      holder,
      mailService: service,
      paypal: 'https://paypal.me/Max-Mustermann',
      bic: 'cobadeffxxx'
    })

    expect(values?.paypal).toBe('Max-Mustermann')
    expect(values?.bic).toBeUndefined()
    expect(values?.iban).toBeUndefined()
  })

  it('stores the PayPal addresses lower-cased and comma-separated', async () => {
    const values = await connector.complete?.({
      holder,
      mailService: service,
      paypal: 'maxmustermann',
      paypalEmails: 'Max@Example.com,  max.mustermann@example.org'
    })

    expect(values?.paypalEmails).toBe('max@example.com, max.mustermann@example.org')
  })
})
