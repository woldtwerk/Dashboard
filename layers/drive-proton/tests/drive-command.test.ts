import { describe, expect, it } from 'vitest'
import {
  buildCopyArgs,
  buildCreateFolderArgs,
  buildInvitationArgs,
  buildListArgs,
  buildMoveArgs,
  buildSetShareArgs,
  buildSizeArgs,
  parseEntries,
  parseEntry,
  parseInvitations,
  parseJson,
  parseShare,
  parseUsedBytes
} from '../server/proton/drive-command'

describe('argv building', () => {
  it('builds a listing command for a path', () => {
    expect(buildListArgs('/my-files/Docs')).toEqual(['filesystem', 'list', '/my-files/Docs'])
  })

  it('builds a size command for the whole drive', () => {
    expect(buildSizeArgs('/my-files')).toEqual(['filesystem', 'size', '/my-files'])
  })

  it('passes names as their own arguments', () => {
    expect(buildCreateFolderArgs('/my-files', 'a/b')).toEqual(['filesystem', 'create-folder', '/my-files', 'a/b'])
  })

  it('adds the copy name flag only when given', () => {
    expect(buildCopyArgs(['/a'], '/target')).toEqual(['filesystem', 'copy', '/a', '/target'])
    expect(buildCopyArgs(['/a'], '/target', 'b')).toEqual(['filesystem', 'copy', '-n', 'b', '/a', '/target'])
  })

  it('lists every path before the target for a move', () => {
    expect(buildMoveArgs(['/a', '/b'], '/target')).toEqual(['filesystem', 'move', '/a', '/b', '/target'])
  })

  it('adds only the share options that are set', () => {
    expect(buildSetShareArgs('/a', { role: 'viewer', expiration: '2026-12-31' })).toEqual([
      'sharing', 'set-url', '--role', 'viewer', '--expiration', '2026-12-31', '/a'
    ])
  })

  it('accepts or rejects an invitation', () => {
    expect(buildInvitationArgs('uid-1', true)).toEqual(['invitation', 'accept', 'uid-1'])
    expect(buildInvitationArgs('uid-1', false)).toEqual(['invitation', 'reject', 'uid-1'])
  })
})

describe('parseJson', () => {
  it('skips progress lines before the JSON', () => {
    expect(parseJson('Downloading...\n{"ok":true}')).toEqual({ ok: true })
  })

  it('returns undefined for empty or non-JSON output', () => {
    expect(parseJson('')).toBeUndefined()
    expect(parseJson('nothing here')).toBeUndefined()
  })
})

describe('parseEntries', () => {
  const stdout = JSON.stringify([
    { uid: 'u1', type: 'folder', name: { ok: true, value: 'Docs' }, modificationTime: '2026-10-01T10:00:00Z' },
    { uid: 'u2', type: 'file', name: { ok: true, value: 'a.txt' }, mediaType: 'text/plain', activeRevision: { claimedSize: 123 } },
    { uid: 'section-my-files' }
  ])

  it('maps entries and drops pseudo sections', () => {
    const entries = parseEntries(stdout, '/my-files')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      uid: 'u1',
      name: 'Docs',
      type: 'folder',
      parent: '/my-files',
      path: '/my-files/Docs',
      size: undefined,
      modified: '2026-10-01T10:00:00Z',
      mediaType: undefined
    })
    expect(entries[1]!.size).toBe(123)
  })

  it('escapes a slash inside a name', () => {
    const entries = parseEntries(JSON.stringify([{ uid: 'u', type: 'file', name: { ok: true, value: 'a/b' } }]), '/my-files')
    expect(entries[0]!.path).toBe('/my-files/a\\/b')
  })

  it('accepts an object with an entries array', () => {
    const entries = parseEntries(JSON.stringify({ entries: [{ uid: 'u', type: 'file', name: 'x' }] }), '/my-files')
    expect(entries.map(entry => entry.name)).toEqual(['x'])
  })
})

describe('parseEntry', () => {
  it('maps one entry and derives its parent from the path', () => {
    const entry = parseEntry(JSON.stringify({ uid: 'u', type: 'file', name: 'a.txt', claimedSize: 5 }), '/my-files/Docs/a.txt')
    expect(entry).toMatchObject({ name: 'a.txt', parent: '/my-files/Docs', size: 5 })
  })

  it('returns undefined for a section', () => {
    expect(parseEntry(JSON.stringify({ uid: 'section' }), '/my-files')).toBeUndefined()
  })
})

describe('parseUsedBytes', () => {
  it('reads the size the CLI reports', () => {
    expect(parseUsedBytes(JSON.stringify({ size: 123456, numberOfDescendants: 12 }))).toBe(123456)
  })

  it('accepts numeric strings and wrapped shapes', () => {
    expect(parseUsedBytes(JSON.stringify({ folderSize: { totalSize: '4096' } }))).toBe(4096)
    expect(parseUsedBytes(JSON.stringify({ data: { usedBytes: 99 } }))).toBe(99)
  })

  it('returns undefined without a byte count', () => {
    expect(parseUsedBytes('')).toBeUndefined()
    expect(parseUsedBytes('{}')).toBeUndefined()
    expect(parseUsedBytes(JSON.stringify({ size: 'unknown' }))).toBeUndefined()
  })
})

describe('parseShare', () => {
  it('reads a public link', () => {
    expect(parseShare(JSON.stringify({ shared: true, url: 'https://drive.proton.me/urls/x', role: 'viewer', password: 'secret' }))).toEqual({
      shared: true,
      url: 'https://drive.proton.me/urls/x',
      role: 'viewer',
      passwordProtected: true,
      expiration: undefined
    })
  })

  it('treats a URL as shared even without a flag', () => {
    expect(parseShare(JSON.stringify({ publicUrl: 'https://drive.proton.me/urls/y' })).shared).toBe(true)
  })

  it('reports an unshared path', () => {
    expect(parseShare('{}')).toEqual({ shared: false, url: undefined, role: undefined, passwordProtected: false, expiration: undefined })
  })
})

describe('parseInvitations', () => {
  it('maps invitation uids and names', () => {
    const invitations = parseInvitations(JSON.stringify([
      { uid: 'i1', name: { ok: true, value: 'Team' }, sharerEmail: 'a@b.c' },
      { invitationUid: 'i2', name: 'Shared folder' }
    ]))
    expect(invitations).toEqual([
      { uid: 'i1', name: 'Team', from: 'a@b.c' },
      { uid: 'i2', name: 'Shared folder', from: undefined }
    ])
  })
})
