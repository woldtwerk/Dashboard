import { describe, expect, it } from 'vitest'
import { pushStateView, pushSupported, urlBase64ToUint8Array } from '../app/utils/web-push'

interface EnvOptions {
  secure?: boolean
  serviceWorker?: boolean
  pushManager?: boolean
  notification?: boolean
}

function env(options: EnvOptions = {}): Window {
  const fake: Record<string, unknown> = {
    isSecureContext: options.secure ?? true
  }

  if (options.serviceWorker !== false) {
    fake.serviceWorker = {}
  }
  if (options.pushManager !== false) {
    fake.PushManager = function PushManager() {}
  }
  if (options.notification !== false) {
    fake.Notification = function Notification() {}
  }

  return fake as unknown as Window
}

describe('urlBase64ToUint8Array', () => {
  it('decodes a base64url string without padding', () => {
    const encoded = Buffer.from('hello world').toString('base64url')

    expect([...urlBase64ToUint8Array(encoded)]).toEqual([...new TextEncoder().encode('hello world')])
  })

  it('decodes the url-safe characters', () => {
    const bytes = Uint8Array.from([0xfb, 0xff, 0xbf])
    const encoded = Buffer.from(bytes).toString('base64url')

    expect(encoded).toContain('_')
    expect([...urlBase64ToUint8Array(encoded)]).toEqual([...bytes])
  })

  it('decodes a value that is already padded', () => {
    const bytes = Uint8Array.from([0x01, 0x02])

    expect([...urlBase64ToUint8Array('AQI=')]).toEqual([...bytes])
  })
})

describe('pushSupported', () => {
  it('is false without a window', () => {
    expect(pushSupported(undefined)).toBe(false)
  })

  it('needs a secure context', () => {
    expect(pushSupported(env({ secure: false }))).toBe(false)
  })

  it('needs serviceWorker, PushManager and Notification', () => {
    expect(pushSupported(env({ serviceWorker: false }))).toBe(false)
    expect(pushSupported(env({ pushManager: false }))).toBe(false)
    expect(pushSupported(env({ notification: false }))).toBe(false)
  })

  it('accepts a fully capable browser', () => {
    expect(pushSupported(env())).toBe(true)
  })
})

describe('pushStateView', () => {
  it('shows an enabled switch once subscribed', () => {
    expect(pushStateView('on')).toEqual({
      enabled: true,
      toggleable: true,
      label: 'Notifications arrive even when no dashboard tab is open.'
    })
  })

  it('explains a blocked permission and offers no switch', () => {
    expect(pushStateView('denied')).toEqual({
      enabled: false,
      toggleable: false,
      label: 'Blocked in the browser settings'
    })
  })

  it('says so when the browser cannot do push', () => {
    expect(pushStateView('unsupported')).toEqual({
      enabled: false,
      toggleable: false,
      label: 'Not supported'
    })
  })

  it('offers to turn push on while it is off', () => {
    expect(pushStateView('off')).toEqual({
      enabled: false,
      toggleable: true,
      label: 'Turn on to receive notifications while the dashboard is closed.'
    })
  })
})
