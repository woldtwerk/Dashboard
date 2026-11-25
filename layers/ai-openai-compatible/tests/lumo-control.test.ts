import { describe, expect, it } from 'vitest'
import { toLumoControlError } from '../server/openai-compatible/lumo-control'

describe('toLumoControlError', () => {
  it('reports an unreachable container', () => {
    expect(toLumoControlError(undefined, undefined).status).toBe(503)
  })

  it.each([401, 403])('reports a control token that does not match (%i)', (status) => {
    const mapped = toLumoControlError(status, { error: 'unauthorized' })

    expect(mapped.status).toBe(503)
    expect(mapped.message).toContain('NUXT_LUMO_TAMER_TOKEN')
  })

  it.each([500, 502, 504])('reports a failing container as a bad gateway (%i)', (status) => {
    expect(toLumoControlError(status, { error: 'proxy restart failed' })).toEqual({
      status: 502,
      message: 'proxy restart failed',
      need: undefined
    })
  })

  it.each([
    ['totp', 'Enter the two-factor code of your Proton account'],
    ['captcha', 'Proton asked for a CAPTCHA. Try again.']
  ])('passes on the missing input %s with a message', (need, message) => {
    expect(toLumoControlError(400, { need })).toEqual({ status: 400, message, need })
  })

  it('passes on the message and the missing input', () => {
    expect(toLumoControlError(400, { error: 'Wrong password', need: 'totp' }))
      .toEqual({ status: 400, message: 'Wrong password', need: 'totp' })
  })

  it('drops an empty need', () => {
    expect(toLumoControlError(400, { need: null }).need).toBeUndefined()
  })
})
