import { describe, expect, it } from 'vitest'
import { filePreviewKind, matchesEtag, readTextUpTo } from '../shared/file-preview'
import { PRIVATE_CACHE, fileResponse } from '../server/utils/file-response'

function upstream(body = 'bytes', headers: Record<string, string> = {}): Response {
  return new Response(body, { headers })
}

describe('fileResponse', () => {
  it('streams a PDF inline with a policy its viewer can run under', () => {
    const result = fileResponse(upstream('pdf', { 'content-type': 'application/pdf' }), { name: 'report.pdf', inline: true })

    expect(result.headers.get('content-type')).toBe('application/pdf')
    expect(result.headers.get('content-disposition')).toBe('inline; filename="report.pdf"; filename*=UTF-8\'\'report.pdf')
    expect(result.headers.get('content-security-policy')).toBe('frame-ancestors \'self\'')
    expect(result.headers.get('x-content-type-options')).toBe('nosniff')
    expect(result.headers.get('cache-control')).toBe('private')
    expect(result.headers.get('accept-ranges')).toBeNull()
  })

  it('serves a raster image inline with loading closed off', () => {
    const result = fileResponse(upstream('img', { 'content-type': 'image/png' }), { name: 'photo.png', inline: true })

    expect(result.headers.get('content-type')).toBe('image/png')
    expect(result.headers.get('content-security-policy')).toBe('default-src \'none\'; frame-ancestors \'self\'')
  })

  it('serves text inline as plain text with a sandbox', () => {
    const result = fileResponse(upstream('hello', { 'content-type': 'text/markdown' }), { name: 'readme.md', inline: true })

    expect(result.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(result.headers.get('content-security-policy')).toBe('sandbox; default-src \'none\'; frame-ancestors \'self\'')
  })

  it('serves a video inline with a sandbox', () => {
    const result = fileResponse(upstream('video', { 'content-type': 'video/mp4' }), { name: 'clip.mp4', inline: true })

    expect(result.headers.get('content-type')).toBe('video/mp4')
    expect(result.headers.get('content-security-policy')).toBe('sandbox; default-src \'none\'; frame-ancestors \'self\'')
  })

  it('never serves SVG or HTML inline', () => {
    for (const [type, name] of [['image/svg+xml', 'logo.svg'], ['text/html', 'page.html']] as const) {
      const result = fileResponse(upstream('<script>', { 'content-type': type }), { name, inline: true })

      expect(result.headers.get('content-type')).toBe(type)
      expect(result.headers.get('content-disposition')).toContain(`attachment; filename="${name}"`)
      expect(result.headers.get('content-security-policy')).toBe('sandbox; default-src \'none\'')
    }
  })

  it('treats a multi-file (zip) response as an attachment', () => {
    const result = fileResponse(upstream('zip', { 'content-type': 'application/zip' }), { name: 'download.zip', inline: true, single: false })

    expect(result.headers.get('content-disposition')).toContain('attachment; filename="download.zip"')
  })

  it('keeps a requested download strict even for a PDF', () => {
    const result = fileResponse(upstream('pdf', { 'content-type': 'application/pdf' }), { name: 'report.pdf', inline: false })

    expect(result.headers.get('content-disposition')).toContain('attachment; filename="report.pdf"')
    expect(result.headers.get('content-security-policy')).toBe('sandbox; default-src \'none\'')
  })

  it('adds the etag and cache header for a versioned preview', () => {
    const result = fileResponse(upstream('pdf', { 'content-type': 'application/pdf' }), { name: 'report.pdf', inline: true, etag: '"7"' })

    expect(result.headers.get('etag')).toBe('"7"')
    expect(result.headers.get('cache-control')).toBe(PRIVATE_CACHE)
  })

  it('falls back to a safe type and sanitizes the filename', () => {
    const result = fileResponse(upstream('x', { 'content-type': 'text/html; evil="</style>"' }), { name: 'a/../../b.bin', inline: true })

    expect(result.headers.get('content-type')).toBe('application/octet-stream')
    expect(result.headers.get('content-disposition')).toBe('attachment; filename="a_.._.._b.bin"; filename*=UTF-8\'\'a%2F..%2F..%2Fb.bin')
  })

  it('adds the UTF-8 filename next to the ASCII fallback', () => {
    const result = fileResponse(upstream('pdf', { 'content-type': 'application/pdf' }), { name: 'Résumé 2026.pdf', inline: true })

    expect(result.headers.get('content-disposition')).toBe('inline; filename="R_sum_ 2026.pdf"; filename*=UTF-8\'\'R%C3%A9sum%C3%A9%202026.pdf')
  })
})

describe('filePreviewKind', () => {
  it('matches the inline allowlist', () => {
    expect(filePreviewKind('application/pdf', 'x')).toBe('pdf')
    expect(filePreviewKind('image/png', 'x')).toBe('image')
    expect(filePreviewKind('video/webm', 'x')).toBe('video')
    expect(filePreviewKind('audio/mpeg', 'x')).toBe('audio')
    expect(filePreviewKind('text/markdown', 'x')).toBe('text')
    expect(filePreviewKind('image/svg+xml', 'x.svg')).toBeUndefined()
    expect(filePreviewKind('text/html', 'x.html')).toBeUndefined()
  })
})

describe('matchesEtag', () => {
  it('matches an exact or weak ETag and a list', () => {
    expect(matchesEtag('"42"', '"42"')).toBe(true)
    expect(matchesEtag('W/"42"', '"42"')).toBe(true)
    expect(matchesEtag('"1", "42"', '"42"')).toBe(true)
    expect(matchesEtag('*', '"42"')).toBe(true)
  })

  it('does not match a different or missing ETag', () => {
    expect(matchesEtag('"43"', '"42"')).toBe(false)
    expect(matchesEtag(undefined, '"42"')).toBe(false)
    expect(matchesEtag('', '"42"')).toBe(false)
  })
})

describe('readTextUpTo', () => {
  it('reads at most the byte cap and reports the truncation', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('hello '))
        controller.enqueue(encoder.encode('world'))
        controller.close()
      }
    })

    expect(await readTextUpTo(stream, 5)).toEqual({ text: 'hello', truncated: true })
  })
})
