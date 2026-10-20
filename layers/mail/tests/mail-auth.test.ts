import { describe, expect, it } from 'vitest'
import { authenticationResultsFromRaw, isDkimAligned } from '../shared/mail-auth'

const options = {
  trustedAuthservIds: ['mx.protonmail.ch', 'protonmail.ch'],
  domains: ['paypal.de', 'paypal.com']
}

describe('isDkimAligned', () => {
  it.each([
    {
      branch: 'a trusted server and a passing signature for the domain',
      headers: ['mx.protonmail.ch; dkim=pass (2048-bit key) header.d=paypal.de header.s=protonmail'],
      expected: true
    },
    {
      branch: 'a signing domain that is a subdomain',
      headers: ['mx.protonmail.ch; dkim=pass header.d=mail.paypal.com'],
      expected: true
    },
    {
      branch: 'a passing header.i identifier',
      headers: ['mx.protonmail.ch; dkim=pass header.i=@paypal.com'],
      expected: true
    },
    {
      branch: 'a failed signature',
      headers: ['mx.protonmail.ch; dkim=fail header.d=paypal.de'],
      expected: false
    },
    {
      branch: 'a pass for another domain',
      headers: ['mx.protonmail.ch; dkim=pass header.d=evil.example'],
      expected: false
    },
    {
      branch: 'a lookalike domain',
      headers: ['mx.protonmail.ch; dkim=pass header.d=paypal.de.evil.com'],
      expected: false
    },
    {
      branch: 'a forged pass under an untrusted topmost header',
      headers: [
        'attacker.example; dkim=pass header.d=paypal.de',
        'mx.protonmail.ch; dkim=pass header.d=paypal.de'
      ],
      expected: false
    },
    {
      branch: 'a trusted topmost header whose later method is another pass',
      headers: ['mx.protonmail.ch; spf=pass smtp.mailfrom=paypal.de; dkim=pass header.d=paypal.de'],
      expected: true
    },
    {
      branch: 'no header at all',
      headers: [],
      expected: false
    },
    {
      branch: 'a header without a separator',
      headers: ['mx.protonmail.ch'],
      expected: false
    }
  ])('answers $expected for $branch', ({ headers, expected }) => {
    expect(isDkimAligned(headers, options)).toBe(expected)
  })
})

describe('authenticationResultsFromRaw', () => {
  it('collects every value in header order and unfolds continuations', () => {
    const raw = [
      'Authentication-Results: mx.protonmail.ch; dkim=pass',
      '\theader.d=paypal.de',
      'Subject: Money received',
      'Authentication-Results: attacker.example; dkim=pass header.d=paypal.de'
    ].join('\r\n')

    expect(authenticationResultsFromRaw(raw)).toEqual([
      'mx.protonmail.ch; dkim=pass header.d=paypal.de',
      'attacker.example; dkim=pass header.d=paypal.de'
    ])
  })
})
