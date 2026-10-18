import { describe, expect, it } from 'vitest'
import {
  base64Url,
  buildImgproxyPath,
  IMAGE_WIDTHS,
  normalizeImageRequest,
  signImgproxyPath,
  signSource,
  snapImageWidth,
  verifySource
} from '../server/utils/imgproxy'
import { decodeImageId, encodeImageId } from '../shared/image-id'

const KEY = '943b421c9eb07c830af81030552c86009268de4e532ba2ee2eab8247c6da0881'
const SALT = '520f986b998545b4785e0defbc4f3c1203f22de2374a3d53cb7a7fe9fea309c5'

/** The signing example from imgproxy's own documentation. */
const DOCUMENTED_PATH = '/rs:fill:300:400:0/g:sm/aHR0cDovL2V4YW1w/bGUuY29tL2ltYWdl/cy9jdXJpb3NpdHku/anBn.png'
const DOCUMENTED_SIGNATURE = '90UxdwGRAI2bpLSHKkZculJau5ahfxfS0h3fMuQAf40'

function statusOf(action: () => unknown): number | undefined {
  try {
    action()
    return undefined
  } catch (error) {
    return (error as { statusCode?: number, status?: number }).statusCode
      ?? (error as { status?: number }).status
  }
}

describe('signImgproxyPath', () => {
  it('reproduces the documented signature', () => {
    expect(signImgproxyPath(DOCUMENTED_PATH, KEY, SALT)).toBe(DOCUMENTED_SIGNATURE)
  })

  it('signs an unsigned deployment with the insecure literal', () => {
    expect(signImgproxyPath(DOCUMENTED_PATH, '', '')).toBe('insecure')
    expect(signImgproxyPath(DOCUMENTED_PATH, KEY, '')).toBe('insecure')
  })

  it('rejects a key or salt that is not hex', () => {
    expect(() => signImgproxyPath(DOCUMENTED_PATH, 'not-hex', SALT)).toThrow('hex')
    expect(() => signImgproxyPath(DOCUMENTED_PATH, KEY, 'abc')).toThrow('hex')
  })
})

describe('buildImgproxyPath', () => {
  const sourceUrl = 'http://web:3000/api/image-source/drive/work/my-files/a.png?v=1-2&sig=abc'

  it('builds a resize with a base64url source and no plain fallback', () => {
    expect(buildImgproxyPath({ width: 256, fit: 'fill', sourceUrl }))
      .toBe(`/rs:fill:256:0:0/${base64Url(sourceUrl)}`)
  })

  it('carries the height and the density', () => {
    expect(buildImgproxyPath({ width: 512, height: 384, fit: 'fit', dpr: 2, sourceUrl }))
      .toBe(`/rs:fit:512:384:0/dpr:2/${base64Url(sourceUrl)}`)
  })

  it('encodes the source so it survives a URL path', () => {
    const encoded = base64Url(sourceUrl)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(encoded, 'base64url').toString()).toBe(sourceUrl)
  })
})

describe('snapImageWidth', () => {
  it('rounds up to the next allowed step and caps at the largest', () => {
    expect(snapImageWidth(1)).toBe(IMAGE_WIDTHS[0])
    expect(snapImageWidth(160)).toBe(256)
    expect(snapImageWidth(256)).toBe(256)
    expect(snapImageWidth(257)).toBe(384)
    expect(snapImageWidth(5000)).toBe(IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1])
  })
})

describe('normalizeImageRequest', () => {
  it('snaps the width and defaults fit and dpr', () => {
    expect(normalizeImageRequest({ w: '200' })).toEqual({ width: 256, height: undefined, fit: 'fill', dpr: 1 })
    expect(normalizeImageRequest({ w: '256', fit: 'fit', dpr: '2' })).toEqual({ width: 256, height: undefined, fit: 'fit', dpr: 2 })
  })

  it('snaps an explicit height', () => {
    expect(normalizeImageRequest({ w: '256', h: '100', fit: 'fill' }))
      .toEqual({ width: 256, height: 128, fit: 'fill', dpr: 1 })
  })

  it('accepts the allowed upper bounds', () => {
    expect(normalizeImageRequest({ w: String(IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]) }).width)
      .toBe(IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1])
  })

  it('rejects a missing, a negative or a non-numeric width with 400', () => {
    expect(statusOf(() => normalizeImageRequest({}))).toBe(400)
    expect(statusOf(() => normalizeImageRequest({ w: '0' }))).toBe(400)
    expect(statusOf(() => normalizeImageRequest({ w: '-10' }))).toBe(400)
    expect(statusOf(() => normalizeImageRequest({ w: 'wide' }))).toBe(400)
    expect(statusOf(() => normalizeImageRequest({ w: ['256', '512'] }))).toBe(400)
  })

  it('rejects an unknown fit or density with 400', () => {
    expect(statusOf(() => normalizeImageRequest({ w: '256', fit: 'cover' }))).toBe(400)
    expect(statusOf(() => normalizeImageRequest({ w: '256', dpr: '3' }))).toBe(400)
    expect(statusOf(() => normalizeImageRequest({ w: '256', dpr: '1.5' }))).toBe(400)
  })
})

describe('signSource / verifySource', () => {
  const secret = 'test-source-secret'
  const id = 'work/my-files/a.png'
  const version = '2026-10-18T09:30:00Z-42'
  // Computed independently with Python's hmac over `drive|work/my-files/a.png|<version>`
  const signature = 'ieqG2f93UnJUUskihoQa6Gs-nkNpOoj5pJtYpjGiutY'

  it('signs source, id and version together', () => {
    expect(signSource('drive', id, version, secret)).toBe(signature)
    expect(verifySource('drive', id, version, signature, secret)).toBe(true)
  })

  it('rejects a tampered id, version or signature', () => {
    expect(verifySource('drive', 'work/my-files/b.png', version, signature, secret)).toBe(false)
    expect(verifySource('drive', id, '2026-10-18T09:30:00Z-43', signature, secret)).toBe(false)
    expect(verifySource('drive', id, '', signature, secret)).toBe(false)
    expect(verifySource('other', id, version, signature, secret)).toBe(false)
    expect(verifySource('drive', id, version, `${signature}x`, secret)).toBe(false)
  })

  it('rejects everything without a secret or a signature', () => {
    expect(verifySource('drive', id, version, signature, '')).toBe(false)
    expect(verifySource('drive', id, version, undefined, secret)).toBe(false)
  })
})

describe('image id encoding', () => {
  it('keeps separators and escapes the segments', () => {
    expect(encodeImageId('work/my-files/a b.png')).toBe('work/my-files/a%20b.png')
    expect(encodeImageId('work/my-files/ä#1.png')).toBe('work/my-files/%C3%A4%231.png')
    expect(decodeImageId('work/my-files/a%20b.png')).toBe('work/my-files/a b.png')
  })

  it('drops a malformed encoding instead of throwing', () => {
    expect(decodeImageId('%E0%A4%A')).toBe('')
    expect(decodeImageId(undefined)).toBe('')
  })
})
