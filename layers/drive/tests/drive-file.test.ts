import { describe, expect, it } from 'vitest'
import { ATTACHMENT_SECURITY_POLICY } from '../../core/shared/file-preview'
import { PRIVATE_CACHE } from '../../core/server/utils/file-response'
import { driveFileResponse } from '../server/utils/drive-file'

function upstream(body = 'bytes', headers: Record<string, string> = {}): Response {
  return new Response(body, { headers })
}

describe('driveFileResponse', () => {
  it('streams a PDF inline with a policy its viewer can run under', () => {
    const result = driveFileResponse(upstream('pdf', { 'content-type': 'application/pdf' }), { name: 'report.pdf', inline: true, single: true })

    expect(result.headers.get('content-type')).toBe('application/pdf')
    expect(result.headers.get('content-disposition')).toBe('inline; filename="report.pdf"; filename*=UTF-8\'\'report.pdf')
    expect(result.headers.get('content-security-policy')).toBe('frame-ancestors \'self\'')
    expect(result.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('serves a raster image inline with loading closed off', () => {
    const result = driveFileResponse(upstream('img', { 'content-type': 'image/png' }), { name: 'photo.png', inline: true, single: true })

    expect(result.headers.get('content-type')).toBe('image/png')
    expect(result.headers.get('content-disposition')).toBe('inline; filename="photo.png"; filename*=UTF-8\'\'photo.png')
    expect(result.headers.get('content-security-policy')).toBe('default-src \'none\'; frame-ancestors \'self\'')
  })

  it('serves text inline as plain text with a sandbox', () => {
    const result = driveFileResponse(upstream('hello', { 'content-type': 'text/markdown' }), { name: 'readme.md', inline: true, single: true })

    expect(result.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(result.headers.get('content-disposition')).toBe('inline; filename="readme.md"; filename*=UTF-8\'\'readme.md')
    expect(result.headers.get('content-security-policy')).toBe('sandbox; default-src \'none\'; frame-ancestors \'self\'')
  })

  it('never serves SVG or HTML inline', () => {
    for (const [type, name] of [['image/svg+xml', 'logo.svg'], ['text/html', 'page.html']] as const) {
      const result = driveFileResponse(upstream('<script>', { 'content-type': type }), { name, inline: true, single: true })

      expect(result.headers.get('content-type')).toBe(type)
      expect(result.headers.get('content-disposition')).toBe(`attachment; filename="${name}"; filename*=UTF-8''${name}`)
      expect(result.headers.get('content-security-policy')).toBe(ATTACHMENT_SECURITY_POLICY)
    }
  })

  it('treats a multi-file (zip) response as an attachment', () => {
    const result = driveFileResponse(upstream('zip', { 'content-type': 'application/zip' }), { name: 'drive-download.zip', inline: true, single: false })

    expect(result.headers.get('content-disposition')).toBe('attachment; filename="drive-download.zip"; filename*=UTF-8\'\'drive-download.zip')
    expect(result.headers.get('content-security-policy')).toBe(ATTACHMENT_SECURITY_POLICY)
  })

  it('keeps a requested download strict even for a PDF', () => {
    const result = driveFileResponse(upstream('pdf', { 'content-type': 'application/pdf' }), { name: 'report.pdf', inline: false, single: true })

    expect(result.headers.get('content-disposition')).toBe('attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf')
    expect(result.headers.get('content-security-policy')).toBe(ATTACHMENT_SECURITY_POLICY)
  })

  it('adds the etag and cache header for a versioned preview', () => {
    const result = driveFileResponse(upstream('pdf', { 'content-type': 'application/pdf' }), { name: 'report.pdf', inline: true, single: true, etag: '"7"' })

    expect(result.headers.get('etag')).toBe('"7"')
    expect(result.headers.get('cache-control')).toBe(PRIVATE_CACHE)
  })

  it('falls back to a safe type and sanitizes the filename', () => {
    const result = driveFileResponse(upstream('x', { 'content-type': 'text/html; evil="</style>"' }), { name: 'a/../../b.bin', inline: true, single: true })

    expect(result.headers.get('content-type')).toBe('application/octet-stream')
    expect(result.headers.get('content-disposition')).toBe('attachment; filename="a_.._.._b.bin"; filename*=UTF-8\'\'a%2F..%2F..%2Fb.bin')
  })

  it('passes the upstream length through', () => {
    const result = driveFileResponse(upstream('hello', { 'content-type': 'text/plain', 'content-length': '5' }), { name: 'notes.txt', inline: true, single: true })

    expect(result.headers.get('content-length')).toBe('5')
  })
})
