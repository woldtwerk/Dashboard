import { describe, expect, it } from 'vitest'
import { ATTACHMENT_SECURITY_POLICY, inlineSecurityHeaders } from '../../core/shared/file-preview'
import { documentsFileResponse } from '../server/utils/documents-file'

function upstream(body = 'bytes', headers: Record<string, string> = {}): Response {
  return new Response(body, { headers })
}

describe('inlineSecurityHeaders', () => {
  it('lets a PDF run its viewer instead of sandboxing it away', () => {
    expect(inlineSecurityHeaders('application/pdf')).toBe('frame-ancestors \'self\'')
    expect(inlineSecurityHeaders('application/pdf; charset=binary')).toBe('frame-ancestors \'self\'')
    expect(inlineSecurityHeaders('Application/PDF')).toBe('frame-ancestors \'self\'')
  })

  it('closes off resource loading for raster images', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/avif']) {
      expect(inlineSecurityHeaders(type)).toBe('default-src \'none\'; frame-ancestors \'self\'')
    }
  })

  it('keeps every other inline type sandboxed', () => {
    expect(inlineSecurityHeaders('text/plain; charset=utf-8')).toBe('sandbox; default-src \'none\'; frame-ancestors \'self\'')
    expect(inlineSecurityHeaders('image/svg+xml')).toBe('sandbox; default-src \'none\'; frame-ancestors \'self\'')
  })

  it('gives an attachment the strictest policy', () => {
    expect(ATTACHMENT_SECURITY_POLICY).toBe('sandbox; default-src \'none\'')
  })
})

describe('documentsFileResponse', () => {
  it('streams a PDF inline with a policy its viewer can run under', () => {
    const result = documentsFileResponse(upstream('pdf', { 'content-type': 'application/pdf' }), { filename: 'report.pdf', inline: true })

    expect(result.headers.get('content-type')).toBe('application/pdf')
    expect(result.headers.get('content-disposition')).toBe('inline; filename="report.pdf"; filename*=UTF-8\'\'report.pdf')
    expect(result.headers.get('content-security-policy')).toBe('frame-ancestors \'self\'')
    expect(result.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('serves a raster image inline with loading closed off', () => {
    const result = documentsFileResponse(upstream('img', { 'content-type': 'image/png' }), { filename: 'scan.png', inline: true })

    expect(result.headers.get('content-type')).toBe('image/png')
    expect(result.headers.get('content-disposition')).toBe('inline; filename="scan.png"; filename*=UTF-8\'\'scan.png')
    expect(result.headers.get('content-security-policy')).toBe('default-src \'none\'; frame-ancestors \'self\'')
  })

  it('never serves SVG or HTML inline', () => {
    for (const type of ['image/svg+xml', 'text/html']) {
      const result = documentsFileResponse(upstream('<script>', { 'content-type': type }), { filename: 'evil', inline: true })

      expect(result.headers.get('content-type')).toBe(type)
      expect(result.headers.get('content-disposition')).toBe('attachment; filename="evil"; filename*=UTF-8\'\'evil')
      expect(result.headers.get('content-security-policy')).toBe(ATTACHMENT_SECURITY_POLICY)
    }
  })

  it('keeps a requested download strict even for a PDF', () => {
    const result = documentsFileResponse(upstream('pdf', { 'content-type': 'application/pdf' }), { filename: 'report.pdf' })

    expect(result.headers.get('content-disposition')).toBe('attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf')
    expect(result.headers.get('content-security-policy')).toBe('sandbox; default-src \'none\'')
  })

  it('falls back to a safe type and sanitizes the filename', () => {
    const result = documentsFileResponse(upstream('x', { 'content-type': 'text/html; evil="</style>"' }), { filename: 'a/../../b.pdf' })

    expect(result.headers.get('content-type')).toBe('application/octet-stream')
    expect(result.headers.get('content-disposition')).toBe('attachment; filename="a_.._.._b.pdf"; filename*=UTF-8\'\'a%2F..%2F..%2Fb.pdf')
  })

  it('passes the upstream length through', () => {
    const result = documentsFileResponse(upstream('hello', { 'content-type': 'text/plain', 'content-length': '5' }), { filename: 'notes.txt' })

    expect(result.headers.get('content-length')).toBe('5')
  })
})
