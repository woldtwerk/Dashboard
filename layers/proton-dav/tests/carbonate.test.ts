import { describe, expect, it } from 'vitest'
import { toCarbonateError, toCarbonateValues, toDavPath } from '../server/carbonate/account'

describe('toDavPath', () => {
  it('adds the protocol root to a base URL', () => {
    expect(toDavPath('http://carbonate:8081', 'caldav')).toBe('http://carbonate:8081/caldav')
    expect(toDavPath('http://carbonate:8081/', 'carddav')).toBe('http://carbonate:8081/carddav')
  })

  it('is idempotent when the path is already there', () => {
    expect(toDavPath('http://carbonate:8081/caldav', 'caldav')).toBe('http://carbonate:8081/caldav')
    expect(toDavPath('http://carbonate:8081/caldav/', 'caldav')).toBe('http://carbonate:8081/caldav')
  })
})

describe('toCarbonateValues', () => {
  const account = {
    account: 'alice',
    dav: { url: 'http://carbonate:8081', username: 'alice@proton.me', password: 'bridge-generated' }
  }

  it('stores the DAV credentials at the protocol root', () => {
    expect(toCarbonateValues(account, 'caldav')).toEqual({
      account: 'alice',
      url: 'http://carbonate:8081/caldav',
      username: 'alice@proton.me',
      password: 'bridge-generated'
    })
  })
})

describe('toCarbonateError', () => {
  it('passes on the message, the missing input and the verification link', () => {
    expect(toCarbonateError(400, { error: 'Proton wants human verification', need: 'verificationToken', verificationUrl: 'https://verify.proton.me/?token=x' })).toEqual({
      status: 400,
      message: 'Proton wants human verification',
      need: 'verificationToken',
      verificationUrl: 'https://verify.proton.me/?token=x'
    })
  })

  it('reports an unreachable container without a response', () => {
    expect(toCarbonateError(undefined, undefined).status).toBe(503)
  })
})
