import { describe, expect, it } from 'vitest'
import type { DriveEntry } from '../shared/types/drive'
import { driveImageId } from '../shared/drive-image'
import {
  DRIVE_PREWARM_MAX_AGE_MS,
  DRIVE_PREWARM_QUEUE_PREFIX,
  drivePrewarmItems,
  drivePrewarmKey,
  pendingPrewarmItems
} from '../server/utils/drive-prewarm'

const NOW = 1_000_000

const image = (name: string, overrides: Partial<DriveEntry> = {}): DriveEntry => ({
  uid: name,
  name,
  type: 'file',
  parent: '/my-files',
  path: `/my-files/${name}`,
  mediaType: 'image/png',
  size: 1024,
  modified: '2026-01-01T00:00:00Z',
  ...overrides
})

describe('drivePrewarmItems', () => {
  it.each([
    {
      branch: 'folders, non-images, oversized and unknown sizes are excluded',
      entries: [
        image('Docs', { type: 'folder', path: '/my-files/Docs' }),
        image('report.pdf', { name: 'report.pdf', mediaType: 'application/pdf' }),
        image('huge.png', { size: 51 * 1024 * 1024 }),
        image('unknown.png', { size: undefined })
      ],
      options: {},
      expected: []
    },
    {
      branch: 'the default order is folders first, name asc, so the cap takes the first names',
      entries: [image('z.png'), image('Docs', { type: 'folder', path: '/my-files/Docs' }), image('m.png'), image('a.png')],
      options: { limit: 2 },
      expected: ['work/my-files/a.png', 'work/my-files/m.png']
    },
    {
      branch: 'the limit is honoured',
      entries: [image('c.png'), image('a.png'), image('b.png')],
      options: { limit: 1 },
      expected: ['work/my-files/a.png']
    },
    {
      branch: 'the cumulative byte budget stops before it is exceeded',
      entries: [image('a.png', { size: 100 }), image('b.png', { size: 200 }), image('c.png', { size: 300 })],
      options: { maxBytes: 350 },
      expected: ['work/my-files/a.png', 'work/my-files/b.png']
    },
    {
      branch: 'duplicate entries are deduped by key',
      entries: [image('a.png'), image('a.png', { uid: 'another-id' })],
      options: {},
      expected: ['work/my-files/a.png']
    }
  ])('$branch', ({ entries, options, expected }) => {
    const items = drivePrewarmItems('work', entries, { ...options, now: NOW })
    expect(items.map(item => item.id)).toEqual(expected)
    expect(items.every(item => item.enqueuedAt === NOW)).toBe(true)
  })
})

describe('pendingPrewarmItems', () => {
  const item = {
    service: 'work',
    id: driveImageId('work', '/my-files/a.png'),
    version: 'v1',
    size: 1024,
    enqueuedAt: NOW
  }

  it.each([
    {
      branch: 'an already queued key is dropped',
      items: [item],
      knownKeys: () => new Set([drivePrewarmKey(item)]),
      expected: []
    },
    {
      branch: 'an item older than the max age is dropped',
      items: [{ ...item, enqueuedAt: NOW - DRIVE_PREWARM_MAX_AGE_MS - 1 }],
      knownKeys: () => new Set<string>(),
      expected: []
    },
    {
      branch: 'a fresh, unqueued item is kept',
      items: [item],
      knownKeys: () => new Set<string>(),
      expected: [item]
    }
  ])('$branch', ({ items, knownKeys, expected }) => {
    expect(pendingPrewarmItems(items, knownKeys(), NOW)).toEqual(expected)
  })
})

describe('drivePrewarmKey', () => {
  it('is stable per version and hashes the identity without the file name', () => {
    const id = driveImageId('work', '/my-files/TopSecretPhoto.png')
    const key = drivePrewarmKey({ service: 'work', id, version: 'v1' })

    expect(key).toBe(drivePrewarmKey({ service: 'work', id, version: 'v1' }))
    expect(key).toMatch(new RegExp(`^${DRIVE_PREWARM_QUEUE_PREFIX}[0-9a-f]{64}$`))
    expect(key).not.toContain('TopSecretPhoto')
    expect(key).not.toContain('/my-files')
    expect(drivePrewarmKey({ service: 'work', id, version: 'v2' })).not.toBe(key)
  })
})
