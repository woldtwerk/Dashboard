import { generateKeyPairSync } from 'node:crypto'
import { dkimSign } from 'mailauth'
import type { DNSResolver } from 'mailauth'
import { describe, expect, it } from 'vitest'
import { verifySenderDkim } from '../server/utils/mail-dkim'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const KEY_RECORD = `v=DKIM1; k=rsa; p=${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`

/**
 * Answers every key lookup with the one test key, so a signature is always
 * cryptographically valid and only the verifier's own rules decide the verdict.
 */
const resolver: DNSResolver = async (_name, rrtype) => rrtype === 'TXT' ? [[KEY_RECORD]] : []

const FROM = 'From: "service@paypal.de" <service@paypal.de>'
const MESSAGE = [
  FROM,
  'To: "Max Mustermann" <Max@Example.com>',
  'Subject: You\'ve got money',
  'Date: Tue, 13 Oct 2026 10:00:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Erika Musterfrau has sent you 7,00 € EUR</p>'
].join('\r\n')

async function signed(
  message = MESSAGE,
  options: { domain?: string, maxBodyLength?: number, headerList?: string[] } = {}
): Promise<string> {
  const result = await dkimSign(message, {
    signatureData: [{
      signingDomain: options.domain ?? 'paypal.de',
      selector: 'ppk',
      privateKey: PRIVATE_KEY,
      headerList: options.headerList ?? ['From', 'Subject', 'Date', 'To', 'MIME-Version', 'Content-Type'],
      maxBodyLength: options.maxBodyLength
    }]
  })

  return result.signatures + message
}

describe('verifySenderDkim', () => {
  it.each([
    { branch: 'a PayPal signature', expected: true, message: () => signed() },
    {
      branch: 'a PayPal signature over a From address on a PayPal subdomain',
      expected: true,
      message: () => signed(MESSAGE.replaceAll('service@paypal.de', 'service@mail.paypal.de'))
    },
    {
      branch: 'a body changed after signing',
      expected: false,
      message: async () => (await signed()).replace('7,00 € EUR', '700,00 € EUR')
    },
    { branch: 'a signature for a lookalike domain', expected: false, message: () => signed(MESSAGE, { domain: 'paypal.de.evil.example' }) },
    { branch: 'a signature for another domain', expected: false, message: () => signed(MESSAGE, { domain: 'evil.example' }) },
    {
      branch: 'a signature over a From address of another domain',
      expected: false,
      message: () => signed(MESSAGE.replaceAll('service@paypal.de', 'service@evil.example'))
    },
    { branch: 'a signature with an l= body length', expected: false, message: () => signed(MESSAGE, { maxBodyLength: 20 }) },
    {
      branch: 'a signature that does not cover the Subject',
      expected: false,
      message: () => signed(MESSAGE, { headerList: ['From', 'Date', 'To'] })
    },
    {
      branch: 'a second From header added after signing',
      expected: false,
      message: async () => `From: attacker@evil.example\r\n${await signed()}`
    },
    {
      branch: 'a mail addressed to the owner',
      expected: true,
      recipients: ['max@example.com'],
      message: () => signed()
    },
    {
      branch: 'a mail addressed to another account',
      expected: false,
      recipients: ['owner@paypal.de'],
      message: () => signed()
    },
    {
      branch: 'a mail addressed to another account, with no recipient to check',
      expected: true,
      recipients: [],
      message: () => signed()
    },
    {
      branch: 'a signature that does not cover the To header',
      expected: false,
      recipients: ['max@example.com'],
      message: () => signed(MESSAGE, { headerList: ['From', 'Subject', 'Date', 'MIME-Version', 'Content-Type'] })
    },
    {
      branch: 'a second To header naming the owner prepended to a mail sent to another account',
      expected: false,
      recipients: ['max@example.com'],
      message: async () => `To: max@example.com\r\n${await signed(MESSAGE.replace('Max@Example.com', 'attacker@evil.example'))}`
    },
    {
      branch: 'a second Subject header prepended after signing',
      expected: false,
      message: async () => `Subject: You have got money\r\n${await signed()}`
    },
    { branch: 'no signature at all', expected: false, message: async () => MESSAGE }
  ])('answers $expected for $branch', async ({ message, expected, recipients }) => {
    const verdict = await verifySenderDkim(await message(), {
      domains: ['paypal.de', 'paypal.com'],
      resolver,
      ...(recipients ? { recipients } : {})
    })

    expect(verdict.ok).toBe(expected)
    if (!expected) {
      expect(verdict.reason).toBeTypeOf('string')
    }
  })
})
