import { describe, expect, it } from 'vitest'
import { matchesEtag, previewContentType } from '../shared/drive-preview'

describe('previewContentType', () => {
  it('render PDFs inline', () => {
    expect(previewContentType('application/pdf', 'doc.pdf')).toBe('application/pdf')
    expect(previewContentType(undefined, 'doc.PDF')).toBe('application/pdf')
  })

  it('renders raster images inline', () => {
    expect(previewContentType('image/png', 'x')).toBe('image/png')
    expect(previewContentType('image/jpeg', 'x')).toBe('image/jpeg')
    expect(previewContentType('image/gif', 'x')).toBe('image/gif')
    expect(previewContentType('image/webp', 'x')).toBe('image/webp')
    expect(previewContentType('image/avif', 'x')).toBe('image/avif')
    expect(previewContentType(undefined, 'photo.jpg')).toBe('image/jpeg')
  })

  it('never renders SVG or HTML inline', () => {
    expect(previewContentType('image/svg+xml', 'x.svg')).toBeUndefined()
    expect(previewContentType(undefined, 'x.svg')).toBeUndefined()
    expect(previewContentType('text/html', 'x.html')).toBeUndefined()
    expect(previewContentType(undefined, 'x.html')).toBeUndefined()
  })

  it('serves text as plain text', () => {
    expect(previewContentType('text/markdown', 'readme')).toBe('text/plain; charset=utf-8')
    expect(previewContentType(undefined, 'readme.md')).toBe('text/plain; charset=utf-8')
    expect(previewContentType('application/json', 'data')).toBe('text/plain; charset=utf-8')
    expect(previewContentType(undefined, 'notes.txt')).toBe('text/plain; charset=utf-8')
  })

  it('does not render scriptable or unknown types', () => {
    expect(previewContentType('text/xml', 'x.xml')).toBeUndefined()
    expect(previewContentType('application/xml', 'x.xml')).toBeUndefined()
    expect(previewContentType('application/javascript', 'x.js')).toBeUndefined()
    expect(previewContentType('application/zip', 'x.zip')).toBeUndefined()
    expect(previewContentType(undefined, 'binary')).toBeUndefined()
  })

  it('ignores content type parameters', () => {
    expect(previewContentType('text/plain; charset=utf-8', 'x')).toBe('text/plain; charset=utf-8')
    expect(previewContentType('application/pdf; foo=bar', 'x')).toBe('application/pdf')
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
