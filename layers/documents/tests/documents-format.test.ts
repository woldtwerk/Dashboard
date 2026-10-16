import { describe, expect, it } from 'vitest'
import { documentIcon, formatBytes, formatDate, formatDateTime, isInlinePreview, userLabel } from '../shared/documents-format'

describe('formatBytes', () => {
  it('scales the unit and handles missing values', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB')
    expect(formatBytes(undefined)).toBe('—')
  })
})

describe('formatDate', () => {
  it('uses the value\'s own digits, without a timezone shift', () => {
    expect(formatDate('2026-03-15')).toBe('2026-03-15')
    expect(formatDate('2026-03-15T23:00:00+02:00')).toBe('2026-03-15')
    expect(formatDate(undefined)).toBe('—')
  })
})

describe('formatDateTime', () => {
  it('keeps the time part', () => {
    expect(formatDateTime('2026-03-15T19:07:08.538821+02:00')).toBe('2026-03-15 19:07')
    expect(formatDateTime(undefined)).toBe('—')
  })
})

describe('isInlinePreview', () => {
  it('allows PDFs and raster images only', () => {
    expect(isInlinePreview('application/pdf')).toBe(true)
    expect(isInlinePreview('image/png')).toBe(true)
    expect(isInlinePreview('image/jpeg')).toBe(true)
    expect(isInlinePreview('image/svg+xml')).toBe(false)
    expect(isInlinePreview('text/html')).toBe(false)
  })
})

describe('documentIcon', () => {
  it('picks an icon from the media type', () => {
    expect(documentIcon({ mimeType: 'application/pdf', title: 'x' })).toBe('i-lucide-file-text')
    expect(documentIcon({ mimeType: 'image/png', title: 'x' })).toBe('i-lucide-file-image')
    expect(documentIcon({ mimeType: 'application/zip', title: 'x' })).toBe('i-lucide-file-archive')
    expect(documentIcon({ mimeType: 'application/octet-stream', title: 'x' })).toBe('i-lucide-file')
  })
})

describe('userLabel', () => {
  it('prefers the full name', () => {
    expect(userLabel({ username: 'admin', firstName: 'Willi', lastName: 'Woldt' })).toBe('Willi Woldt')
    expect(userLabel({ username: 'admin' })).toBe('admin')
  })
})
