import { describe, expect, it } from 'vitest'
import { isUrlWithin, resolveHref, sameOrigin, sameResolvedUrl, sameUrl } from '../server/utils/url'

describe('sameOrigin', () => {
  it('compares scheme, host and port', () => {
    expect(sameOrigin('https://dav.example.com/caldav', 'https://dav.example.com/cal/one.ics')).toBe(true)
    expect(sameOrigin('https://dav.example.com', 'https://evil.example.com/x.ics')).toBe(false)
    expect(sameOrigin('https://dav.example.com', 'http://dav.example.com')).toBe(false)
    expect(sameOrigin('https://dav.example.com', 'https://dav.example.com:8443')).toBe(false)
  })

  it('is false for a URL that does not parse', () => {
    expect(sameOrigin('not a url', 'https://dav.example.com')).toBe(false)
    expect(sameOrigin(undefined, undefined)).toBe(false)
  })
})

describe('sameUrl', () => {
  it('ignores a trailing slash', () => {
    expect(sameUrl('https://dav.example.com/cal/one/', 'https://dav.example.com/cal/one')).toBe(true)
    expect(sameUrl('https://dav.example.com/cal/one', 'https://dav.example.com/cal/two')).toBe(false)
  })
})

describe('resolveHref', () => {
  it('resolves a relative href against the collection', () => {
    expect(resolveHref('https://dav.example.com/cal/one/', 'event.ics')).toBe('https://dav.example.com/cal/one/event.ics')
    expect(resolveHref('https://dav.example.com/cal/one/', '/cal/one/event.ics')).toBe('https://dav.example.com/cal/one/event.ics')
  })

  it('leaves an absolute href as it is and rejects nothing usable', () => {
    expect(resolveHref('https://dav.example.com/cal/', 'https://dav.example.com/cal/event.ics')).toBe('https://dav.example.com/cal/event.ics')
    expect(resolveHref('not a url', 'event.ics')).toBeUndefined()
    expect(resolveHref('https://dav.example.com/cal/', undefined)).toBeUndefined()
  })
})

describe('sameResolvedUrl', () => {
  const collection = 'https://dav.example.com/caldav/calendars/work/'

  it('matches a relative href against an absolute one from the same collection', () => {
    expect(sameResolvedUrl(collection, 'event.ics', 'https://dav.example.com/caldav/calendars/work/event.ics')).toBe(true)
    expect(sameResolvedUrl(collection, 'https://dav.example.com/caldav/calendars/work/event.ics', '/caldav/calendars/work/event.ics')).toBe(true)
  })

  it('does not match another object or another host', () => {
    expect(sameResolvedUrl(collection, 'event.ics', 'https://dav.example.com/caldav/calendars/work/other.ics')).toBe(false)
    expect(sameResolvedUrl(collection, 'event.ics', 'https://evil.example.com/caldav/calendars/work/event.ics')).toBe(false)
    expect(sameResolvedUrl(collection, 'event.ics', undefined)).toBe(false)
  })
})

describe('isUrlWithin', () => {
  const collection = 'https://dav.example.com/caldav/calendars/work/'

  it('accepts an object inside the collection', () => {
    expect(isUrlWithin(collection, 'https://dav.example.com/caldav/calendars/work/event.ics')).toBe(true)
    expect(isUrlWithin('https://dav.example.com/cal', 'https://dav.example.com/cal/event.ics')).toBe(true)
  })

  it('rejects another origin, however it is spelled', () => {
    expect(isUrlWithin(collection, 'https://evil.example.com/caldav/calendars/work/event.ics')).toBe(false)
    expect(isUrlWithin(collection, 'http://dav.example.com/caldav/calendars/work/event.ics')).toBe(false)
  })

  it('rejects a sibling or parent path', () => {
    expect(isUrlWithin(collection, 'https://dav.example.com/caldav/calendars/other/event.ics')).toBe(false)
    expect(isUrlWithin(collection, 'https://dav.example.com/caldav/calendars/')).toBe(false)
    expect(isUrlWithin(collection, 'https://dav.example.com/event.ics')).toBe(false)
  })

  it('rejects the collection itself', () => {
    expect(isUrlWithin(collection, collection)).toBe(false)
  })

  it('rejects traversal, encoded or not', () => {
    expect(isUrlWithin(collection, 'https://dav.example.com/caldav/calendars/work/../../../etc/passwd')).toBe(false)
    expect(isUrlWithin(collection, 'https://dav.example.com/caldav/calendars/work/%2e%2e/%2e%2e/secret.ics')).toBe(false)
    expect(isUrlWithin(collection, 'https://dav.example.com/caldav/calendars/work/..%2fsecret.ics')).toBe(false)
  })
})
