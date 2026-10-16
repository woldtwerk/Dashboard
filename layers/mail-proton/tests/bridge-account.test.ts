import { describe, expect, it } from 'vitest'
import { toBridgeError, toBridgeValues } from '../server/proton/bridge-account'

const account = {
  account: 'alice',
  imap: { username: 'alice@proton.me', password: 'bridge-generated', port: 1144 },
  cert: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n'
}

describe('toBridgeValues', () => {
  it('points IMAP at the host of the control API', () => {
    expect(toBridgeValues(account, 'http://proton-bridge:8080')).toEqual({
      account: 'alice',
      host: 'proton-bridge',
      port: 1144,
      user: 'alice@proton.me',
      tlsCert: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'
    })
  })

  it('leaves the IMAP password out', () => {
    expect(Object.values(toBridgeValues(account, 'http://proton-bridge:8080'))).not.toContain('bridge-generated')
  })
})

describe('toBridgeError', () => {
  it('passes on the message and the missing input', () => {
    expect(toBridgeError(400, { error: 'Enter the two-factor code', need: 'totp' })).toEqual({ status: 400, message: 'Enter the two-factor code', need: 'totp' })
    expect(toBridgeError(404, { error: 'No account', need: null })).toEqual({ status: 404, message: 'No account', need: undefined })
  })

  it('reports an unreachable container without a response', () => {
    expect(toBridgeError(undefined, undefined).status).toBe(503)
  })
})
