import { describe, expect, it } from 'vitest'
import { isCacheableNavigation, notificationFromPayload, sameOriginPath } from '../app/utils/service-worker'

describe('sameOriginPath', () => {
  it.each([
    ['/mail/1', '/mail/1'],
    ['//evil.com', undefined],
    ['https://evil.com/x', undefined],
    ['javascript:alert(1)', undefined],
    [42, undefined],
    [undefined, undefined]
  ])('maps %o to %o', (input, expected) => {
    expect(sameOriginPath(input)).toBe(expected)
  })
})

describe('isCacheableNavigation', () => {
  it.each([
    ['/api/x', false],
    ['/mcp', false],
    ['/_client-access/dav-auth', false],
    ['/mail', true]
  ])('maps %o to %o', (pathname, expected) => {
    expect(isCacheableNavigation(pathname)).toBe(expected)
  })
})

describe('notificationFromPayload', () => {
  it.each([undefined, null, {}, 'not json', { title: '' }])('falls back for %o', (payload) => {
    const { title, options } = notificationFromPayload(payload)

    expect(title).toBe('Allmight')
    expect(options.data.to).toBeUndefined()
  })

  it('keeps a same-origin target and drops an off-origin one', () => {
    expect(notificationFromPayload({ to: '/mail/1' }).options.data.to).toBe('/mail/1')
    expect(notificationFromPayload({ to: 'https://evil.com/x' }).options.data.to).toBeUndefined()
  })
})
