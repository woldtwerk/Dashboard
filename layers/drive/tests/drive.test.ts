import { describe, expect, it } from 'vitest'
import type { DriveEntry } from '../shared/types/drive'
import { baseName, breadcrumbs, escapeSegment, isWithinPath, joinPath, parentPath, splitPath, unescapeSegment } from '../shared/drive-path'
import { applySelection, downloadUrl, entryIcon, entryKindLabel, filterEntries, formatDate, formatSize, previewKind, sectionOf, sortEntries } from '../app/utils/drive'

const file = (name: string, overrides: Partial<DriveEntry> = {}): DriveEntry => ({
  uid: name,
  name,
  type: 'file',
  parent: '/my-files',
  path: `/my-files/${name}`,
  ...overrides
})

describe('drive paths', () => {
  it('escapes and unescapes a slash inside a name', () => {
    expect(escapeSegment('a/b')).toBe('a\\/b')
    expect(unescapeSegment('a\\/b')).toBe('a/b')
    expect(joinPath('/my-files', 'a/b')).toBe('/my-files/a\\/b')
  })

  it('splits on real slashes but not on escaped ones', () => {
    expect(splitPath('/my-files/a\\/b/c')).toEqual(['my-files', 'a\\/b', 'c'])
  })

  it('joins and walks back up', () => {
    expect(joinPath('/my-files', 'Docs')).toBe('/my-files/Docs')
    expect(parentPath('/my-files/Docs/file.txt')).toBe('/my-files/Docs')
    expect(parentPath('/my-files')).toBe('/')
    expect(baseName('/my-files/Docs/file.txt')).toBe('file.txt')
    expect(baseName('/my-files/a\\/b')).toBe('a/b')
  })

  it('builds breadcrumbs with full paths', () => {
    expect(breadcrumbs('/my-files/Docs/a.txt')).toEqual([
      { name: 'my-files', path: '/my-files' },
      { name: 'Docs', path: '/my-files/Docs' },
      { name: 'a.txt', path: '/my-files/Docs/a.txt' }
    ])
  })

  it('decides whether a path lies within another', () => {
    expect(isWithinPath('/my-files', '/my-files/Docs')).toBe(true)
    expect(isWithinPath('/my-files', '/my-files')).toBe(true)
    expect(isWithinPath('/my-files', '/trash')).toBe(false)
  })
})

describe('sectionOf', () => {
  it('finds the section a path belongs to', () => {
    expect(sectionOf('/my-files/Docs').key).toBe('my-files')
    expect(sectionOf('/shared-with-me/Folder').key).toBe('shared')
    expect(sectionOf('/trash/a.txt').key).toBe('trash')
    expect(sectionOf('/unknown').key).toBe('my-files')
  })
})

describe('formatSize', () => {
  it('formats bytes with a unit', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(900)).toBe('900 B')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatSize(undefined)).toBe('—')
  })
})

describe('formatDate', () => {
  it('keeps the provider digits, without a timezone shift', () => {
    expect(formatDate('2026-10-16T09:30:00Z')).toBe('2026-10-16 09:30')
    expect(formatDate(undefined)).toBe('—')
  })
})

describe('entryIcon and kind', () => {
  it('maps media types to icons', () => {
    expect(entryIcon({ type: 'folder' })).toBe('i-lucide-folder')
    expect(entryIcon({ type: 'file', mediaType: 'image/png' })).toBe('i-lucide-file-image')
    expect(entryIcon({ type: 'file', mediaType: 'application/pdf' })).toBe('i-lucide-file-text')
    expect(entryIcon({ type: 'file', mediaType: 'application/zip' })).toBe('i-lucide-file-archive')
  })

  it('labels the kind', () => {
    expect(entryKindLabel({ type: 'folder', name: 'x' })).toBe('Folder')
    expect(entryKindLabel({ type: 'file', mediaType: 'application/pdf', name: 'x' })).toBe('PDF document')
    expect(entryKindLabel({ type: 'file', mediaType: 'image/png', name: 'x' })).toBe('PNG image')
    expect(entryKindLabel({ type: 'file', name: 'notes.md' })).toBe('MD file')
  })

  it('detects previewable kinds', () => {
    expect(previewKind({ type: 'file', mediaType: 'image/jpeg', name: 'x' })).toBe('image')
    expect(previewKind({ type: 'file', mediaType: 'application/pdf', name: 'x' })).toBe('pdf')
    expect(previewKind({ type: 'file', mediaType: '', name: 'a.txt' })).toBe('text')
    expect(previewKind({ type: 'folder', name: 'x' })).toBeUndefined()
  })
})

describe('sortEntries', () => {
  const folder = file('Beta', { type: 'folder', path: '/my-files/Beta' })

  it('keeps folders first and sorts by name', () => {
    const sorted = sortEntries([file('a.txt'), folder, file('c.txt'), file('b.txt')], 'name', 'asc')
    expect(sorted.map(entry => entry.name)).toEqual(['Beta', 'a.txt', 'b.txt', 'c.txt'])
  })

  it('sorts by size descending without moving folders', () => {
    const sorted = sortEntries([file('a', { size: 10 }), file('b', { size: 100 }), folder], 'size', 'desc')
    expect(sorted.map(entry => entry.name)).toEqual(['Beta', 'b', 'a'])
  })

  it('sorts by modified date', () => {
    const sorted = sortEntries([
      file('a', { modified: '2026-01-02T00:00:00Z' }),
      file('b', { modified: '2026-01-01T00:00:00Z' })
    ], 'modified', 'asc')
    expect(sorted.map(entry => entry.name)).toEqual(['b', 'a'])
  })
})

describe('filterEntries', () => {
  it('matches names case-insensitively', () => {
    const entries = [file('Report.pdf'), file('photo.png')]
    expect(filterEntries(entries, 'report').map(entry => entry.name)).toEqual(['Report.pdf'])
    expect(filterEntries(entries, '')).toHaveLength(2)
  })
})

describe('applySelection', () => {
  const visible = ['/a', '/b', '/c', '/d']

  it('replaces on a plain click', () => {
    expect(applySelection({ selected: ['/a'] }, visible, '/c', 'replace')).toEqual({ selected: ['/c'], anchor: '/c' })
  })

  it('toggles on ctrl-click', () => {
    expect(applySelection({ selected: ['/a'] }, visible, '/c', 'toggle').selected).toEqual(['/a', '/c'])
    expect(applySelection({ selected: ['/a', '/c'] }, visible, '/c', 'toggle').selected).toEqual(['/a'])
  })

  it('selects a range from the anchor on shift-click', () => {
    expect(applySelection({ selected: ['/b'], anchor: '/b' }, visible, '/d', 'range').selected).toEqual(['/b', '/c', '/d'])
    expect(applySelection({ selected: ['/d'], anchor: '/d' }, visible, '/b', 'range').selected).toEqual(['/b', '/c', '/d'])
  })

  it('falls back to a single selection without a usable anchor', () => {
    expect(applySelection({ selected: [] }, visible, '/c', 'range')).toEqual({ selected: ['/c'], anchor: '/c' })
  })
})

describe('downloadUrl', () => {
  it('repeats the path for several entries', () => {
    expect(downloadUrl('svc', ['/a', '/b'])).toBe('/api/drive/download?service=svc&path=%2Fa&path=%2Fb')
  })
})
