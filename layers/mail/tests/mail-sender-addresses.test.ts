import { describe, expect, it } from 'vitest'
import {
  addSenderAddress,
  mergeSenderAddresses,
  removeSenderAddress,
  SENDER_ADDRESSES_MAX
} from '../shared/mail-sender-addresses'

describe('mergeSenderAddresses', () => {
  it('keeps the setup login first, then the manual addresses, then the sent ones', () => {
    expect(mergeSenderAddresses('me@example.com', ['alias@example.com'], ['old@example.com']))
      .toEqual(['me@example.com', 'alias@example.com', 'old@example.com'])
  })

  it('drops repeats across the three sources, keeping the first place', () => {
    expect(mergeSenderAddresses('me@example.com', ['Me@Example.com', 'alias@example.com'], ['alias@example.com', 'me@example.com']))
      .toEqual(['me@example.com', 'alias@example.com'])
  })

  it('normalizes every entry and drops the invalid ones', () => {
    expect(mergeSenderAddresses(' Me@Example.com ', [' Alias@Example.com ', 'nope'], []))
      .toEqual(['me@example.com', 'alias@example.com'])
  })

  it('still returns the manual and sent addresses without a setup address', () => {
    expect(mergeSenderAddresses(undefined, ['alias@example.com'], ['old@example.com']))
      .toEqual(['alias@example.com', 'old@example.com'])
  })

  it('is empty without any address', () => {
    expect(mergeSenderAddresses(undefined, [], [])).toEqual([])
  })
})

describe('addSenderAddress', () => {
  it('adds the normalized address', () => {
    expect(addSenderAddress(['me@example.com'], ' Alias@Example.COM ')).toEqual({
      ok: true,
      addresses: ['me@example.com', 'alias@example.com']
    })
  })

  it('rejects an address that is not valid', () => {
    expect(addSenderAddress([], 'not-an-address')).toEqual({
      ok: false,
      error: 'Enter an email address such as alias@example.com.'
    })
  })

  it('rejects a duplicate regardless of case', () => {
    expect(addSenderAddress(['alias@example.com'], 'ALIAS@example.com')).toEqual({
      ok: false,
      error: 'This address is already in the list.'
    })
  })

  it('rejects one more than the limit', () => {
    const addresses = Array.from({ length: SENDER_ADDRESSES_MAX }, (_, index) => `alias${index}@example.com`)

    expect(addSenderAddress(addresses, `alias${SENDER_ADDRESSES_MAX}@example.com`)).toEqual({
      ok: false,
      error: `At most ${SENDER_ADDRESSES_MAX} addresses per account are allowed.`
    })
  })
})

describe('removeSenderAddress', () => {
  it('removes the address regardless of case and leaves the order alone', () => {
    expect(removeSenderAddress(['me@example.com', 'alias@example.com'], 'ALIAS@example.com'))
      .toEqual(['me@example.com'])
  })

  it('leaves an unknown address out of the change', () => {
    expect(removeSenderAddress(['me@example.com'], 'alias@example.com')).toEqual(['me@example.com'])
  })
})
