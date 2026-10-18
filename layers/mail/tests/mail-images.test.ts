import { describe, expect, it } from 'vitest'
import { hasRemoteImages, isTrustedImageSender, normalizeTrustedImageSender, trustedImageSender } from '../shared/mail-images'

describe('normalizeTrustedImageSender', () => {
  it('normalizes an address', () => {
    expect(normalizeTrustedImageSender('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com')
    expect(normalizeTrustedImageSender('Jane Doe <jane@example.com>')).toBe('jane@example.com')
  })

  it('normalizes a whole-domain entry', () => {
    expect(normalizeTrustedImageSender(' @Example.COM ')).toBe('@example.com')
    expect(normalizeTrustedImageSender('@news.example.com')).toBe('@news.example.com')
  })

  it('rejects anything that is neither an address nor a domain', () => {
    expect(normalizeTrustedImageSender('Jane Doe')).toBeUndefined()
    expect(normalizeTrustedImageSender('@example')).toBeUndefined()
    expect(normalizeTrustedImageSender('jane@localhost')).toBeUndefined()
    expect(normalizeTrustedImageSender('')).toBeUndefined()
    expect(normalizeTrustedImageSender(undefined)).toBeUndefined()
  })
})

describe('trustedImageSender', () => {
  it('matches a trusted address', () => {
    expect(trustedImageSender('jane@example.com', ['jane@example.com'])).toBe('jane@example.com')
    expect(isTrustedImageSender('jane@example.com', ['jane@example.com'])).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(isTrustedImageSender('Jane@Example.COM', ['JANE@example.com'])).toBe(true)
    expect(isTrustedImageSender('jane@example.com', ['@EXAMPLE.com'])).toBe(true)
  })

  it('reads a display name from the sender', () => {
    expect(isTrustedImageSender('Jane Doe <jane@example.com>', ['jane@example.com'])).toBe(true)
  })

  it('matches a whole domain, not just one of its addresses', () => {
    expect(isTrustedImageSender('anything@example.com', ['@example.com'])).toBe(true)
    expect(trustedImageSender('anything@example.com', ['@example.com'])).toBe('@example.com')
  })

  it('does not match a subdomain unless it is listed itself', () => {
    expect(isTrustedImageSender('news@mail.example.com', ['@example.com'])).toBe(false)
    expect(isTrustedImageSender('news@mail.example.com', ['@mail.example.com'])).toBe(true)
  })

  it('does not treat a domain entry as an address entry', () => {
    expect(isTrustedImageSender('@example.com', ['@example.com'])).toBe(false)
    expect(isTrustedImageSender('jane@example.com', ['john@example.com'])).toBe(false)
  })

  it('is false for a sender that is not an address', () => {
    expect(isTrustedImageSender(undefined, ['jane@example.com'])).toBe(false)
    expect(isTrustedImageSender('jane', ['jane@example.com'])).toBe(false)
  })
})

describe('hasRemoteImages', () => {
  it('finds remote image sources and CSS backgrounds', () => {
    expect(hasRemoteImages('<img src="https://example.com/pixel.png">')).toBe(true)
    expect(hasRemoteImages('<div style="background:url(https://example.com/a.png)">')).toBe(true)
    expect(hasRemoteImages('<img src="data:image/png;base64,AAAA">')).toBe(false)
    expect(hasRemoteImages('<p>No images</p>')).toBe(false)
    expect(hasRemoteImages(undefined)).toBe(false)
  })
})
