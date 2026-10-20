import { describe, expect, it } from 'vitest'
import { isMimeGlob, matchesMimeGlob, parseMimeGlobs } from '../shared/mime'
import { mimeTypeForExtension, resolveMimeType } from '../../core/shared/mime'

describe('isMimeGlob', () => {
  it('accepts a media type or a type wildcard', () => {
    expect(isMimeGlob('application/pdf')).toBe(true)
    expect(isMimeGlob('video/*')).toBe(true)
    expect(isMimeGlob('VIDEO/MP4')).toBe(true)
  })

  it('rejects a bare type, a subtype wildcard and junk', () => {
    expect(isMimeGlob('video')).toBe(false)
    expect(isMimeGlob('*/pdf')).toBe(false)
    expect(isMimeGlob('video/')).toBe(false)
    expect(isMimeGlob('')).toBe(false)
  })
})

describe('matchesMimeGlob', () => {
  it('accepts everything without a filter', () => {
    expect(matchesMimeGlob('application/pdf')).toBe(true)
    expect(matchesMimeGlob('application/pdf', [])).toBe(true)
  })

  it('matches the type wildcard and an exact media type', () => {
    expect(matchesMimeGlob('video/mp4', ['video/*'])).toBe(true)
    expect(matchesMimeGlob('application/pdf', ['application/pdf'])).toBe(true)
    expect(matchesMimeGlob('video/mp4', ['application/pdf'])).toBe(false)
    expect(matchesMimeGlob('application/pdf', ['image/*'])).toBe(false)
  })

  it('ignores parameters and case', () => {
    expect(matchesMimeGlob('VIDEO/MP4; codecs="avc1"', ['video/*'])).toBe(true)
    expect(matchesMimeGlob('Text/CSV; charset=utf-8', ['text/csv'])).toBe(true)
  })

  it('treats an invalid glob as matching nothing', () => {
    expect(matchesMimeGlob('video/mp4', ['video'])).toBe(false)
  })
})

describe('parseMimeGlobs', () => {
  it('splits commas and whitespace, lower-cases and deduplicates', () => {
    expect(parseMimeGlobs('video/*, application/pdf  image/*, VIDEO/*')).toEqual(['video/*', 'application/pdf', 'image/*'])
  })

  it('drops invalid entries so a half-typed value matches nothing silently', () => {
    expect(parseMimeGlobs('video, application/pdf')).toEqual(['application/pdf'])
    expect(parseMimeGlobs('')).toEqual([])
  })
})

describe('media type inference', () => {
  it('maps the attachment extensions an octet stream can carry', () => {
    const expected: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      m4v: 'video/x-m4v',
      webm: 'video/webm',
      mkv: 'video/x-matroska',
      avi: 'video/x-msvideo',
      jpg: 'image/jpeg',
      png: 'image/png',
      heic: 'image/heic',
      pdf: 'application/pdf'
    }

    for (const [extension, mimeType] of Object.entries(expected)) {
      expect(mimeTypeForExtension(extension), extension).toBe(mimeType)
    }
  })

  it('trusts a real media type and infers a generic or empty one from the name', () => {
    expect(resolveMimeType('video/mp4', 'holiday.mp4')).toBe('video/mp4')
    expect(resolveMimeType('application/octet-stream', 'holiday.mp4')).toBe('video/mp4')
    expect(resolveMimeType('', 'holiday.MOV')).toBe('video/quicktime')
    expect(resolveMimeType(undefined, 'photo.heic')).toBe('image/heic')
    expect(resolveMimeType('application/octet-stream', 'unknown.xyz')).toBe('application/octet-stream')
  })

  it('matches video/* for an octet-stream attachment with a video extension', () => {
    expect(matchesMimeGlob('application/octet-stream', ['video/*'], 'holiday.mp4')).toBe(true)
    expect(matchesMimeGlob('', ['video/*'], 'clip.mkv')).toBe(true)
    expect(matchesMimeGlob('application/octet-stream', ['video/*'], 'document.pdf')).toBe(false)
    expect(matchesMimeGlob('application/octet-stream', ['image/*'], 'photo.jpg')).toBe(true)
  })
})
