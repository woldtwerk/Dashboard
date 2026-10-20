import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateMailIdentity, senderAddressFor } from '../server/utils/mail-identity'

const own = ['me@example.com', 'alias@example.com']

/** The slice of Nitro's storage the identity cache touches, without a driver */
function memoryStorage() {
  const items = new Map<string, unknown>()

  return {
    getMounts: () => [],
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      items.set(key, value)
    },
    removeItem: async (key: string) => {
      items.delete(key)
    },
    getKeys: async (base?: string) => [...items.keys()].filter(key => !base || key.startsWith(base))
  }
}

describe('senderAddressFor', () => {
  it('accepts one of the account\'s own addresses', () => {
    expect(senderAddressFor(own, 'me@example.com', 'alias@example.com')).toEqual({ ok: true, address: 'alias@example.com' })
  })

  it('normalizes the requested address before accepting it', () => {
    expect(senderAddressFor(own, 'me@example.com', 'AlIas@Example.COM')).toEqual({ ok: true, address: 'alias@example.com' })
    expect(senderAddressFor(own, 'me@example.com', 'Alias <alias@example.com>')).toEqual({ ok: true, address: 'alias@example.com' })
  })

  it('rejects an address the account does not own with a 400', () => {
    const result = senderAddressFor(own, 'me@example.com', 'evil@example.com')

    expect(result).toEqual({ ok: false, status: 400, error: 'This account cannot send as evil@example.com' })
  })

  it('rejects a malformed requested address without echoing a line break', () => {
    const result = senderAddressFor(own, 'me@example.com', 'evil@example.com\r\nBcc: x')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).not.toContain('\n')
    }
  })

  it('uses the setup address when none is requested', () => {
    expect(senderAddressFor(own, 'me@example.com')).toEqual({ ok: true, address: 'me@example.com' })
  })

  it('fails with a 500 when the account has no setup address', () => {
    expect(senderAddressFor(own, undefined)).toEqual({ ok: false, status: 500, error: 'The mail account has no sender address' })
  })
})

describe('invalidateMailIdentity', () => {
  let storage: ReturnType<typeof memoryStorage>

  beforeEach(() => {
    storage = memoryStorage()
    vi.stubGlobal('useStorage', () => storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('drops the cached identity of every account and nothing else', async () => {
    await storage.setItem('mail:identity:mail-1', ['me@example.com'])
    await storage.setItem('mail:identity:mail-2', ['other@example.com'])
    await storage.setItem('mail:folders:mail-1', ['INBOX'])
    await storage.setItem('unrelated:key', true)

    await invalidateMailIdentity()

    expect(await storage.getKeys()).toEqual(['mail:folders:mail-1', 'unrelated:key'])
  })

  it('does nothing when no identity is cached', async () => {
    await storage.setItem('mail:folders:mail-1', ['INBOX'])

    await expect(invalidateMailIdentity()).resolves.toBeUndefined()
    expect(await storage.getKeys()).toEqual(['mail:folders:mail-1'])
  })
})
