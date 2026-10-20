import { describe, expect, it } from 'vitest'
import { DRIVE_FILE_NAME_MAX_BYTES, folderSteps, sanitizeDriveFileName, sha256Hex, suffixedDriveName, uniqueDriveName } from '../shared/drive-upload'

describe('uniqueDriveName', () => {
  it('keeps a free name', () => {
    expect(uniqueDriveName([], 'report.pdf', 10)).toBe('report.pdf')
    expect(uniqueDriveName([{ name: 'other.pdf', size: 10 }], 'report.pdf', 10)).toBe('report.pdf')
  })

  it('skips a same-name file of the same size, whatever the conflict rule', () => {
    const existing = [{ name: 'report.pdf', size: 10 }]
    expect(uniqueDriveName(existing, 'report.pdf', 10)).toBeNull()
    expect(uniqueDriveName(existing, 'report.pdf', 10, 'skip')).toBeNull()
    expect(uniqueDriveName(existing, 'report.pdf', 10, 'rename')).toBeNull()
  })

  it('renames a same-name file of another size', () => {
    expect(uniqueDriveName([{ name: 'report.pdf', size: 9 }], 'report.pdf', 10)).toBe('report (1).pdf')
    expect(uniqueDriveName([
      { name: 'report.pdf', size: 9 },
      { name: 'report (1).pdf', size: 9 }
    ], 'report.pdf', 10)).toBe('report (2).pdf')
  })

  it('skips every same-name candidate when the conflict rule is skip', () => {
    expect(uniqueDriveName([{ name: 'report.pdf', size: 9 }], 'report.pdf', 10, 'skip')).toBeNull()
  })

  it('takes a same-name file of the same size through the conflict rule when the check is off', () => {
    const existing = [{ name: 'report.pdf', size: 10 }]
    expect(uniqueDriveName(existing, 'report.pdf', 10, 'rename', false)).toBe('report (1).pdf')
    expect(uniqueDriveName(existing, 'report.pdf', 10, 'skip', false)).toBeNull()
    expect(uniqueDriveName([
      { name: 'report.pdf', size: 10 },
      { name: 'report (1).pdf', size: 10 }
    ], 'report.pdf', 10, 'rename', false)).toBe('report (2).pdf')
  })

  it('recognises an already saved renamed file on a rerun', () => {
    expect(uniqueDriveName([
      { name: 'report.pdf', size: 9 },
      { name: 'report (1).pdf', size: 10 }
    ], 'report.pdf', 10)).toBeNull()
  })

  it('keeps the extension last and a dotfile intact', () => {
    expect(suffixedDriveName('archive.tar.gz', 2)).toBe('archive.tar (2).gz')
    expect(suffixedDriveName('.env', 1)).toBe('.env (1)')
    expect(suffixedDriveName('README', 1)).toBe('README (1)')
  })
})

describe('folderSteps', () => {
  it('creates every folder below the section root, outermost first', () => {
    expect(folderSteps('/my-files/Public/salsa')).toEqual([
      { parent: '/my-files', name: 'Public', path: '/my-files/Public' },
      { parent: '/my-files/Public', name: 'salsa', path: '/my-files/Public/salsa' }
    ])
  })

  it('creates nothing for a section root itself', () => {
    expect(folderSteps('/my-files')).toEqual([])
    expect(folderSteps('/')).toEqual([])
  })

  it('honours escaped slashes in a folder name', () => {
    expect(folderSteps('/my-files/a\\/b')).toEqual([
      { parent: '/my-files', name: 'a/b', path: '/my-files/a\\/b' }
    ])
  })
})

describe('sha256Hex', () => {
  it('hashes the bytes as lower-case hex', async () => {
    const encoder = new TextEncoder()
    expect(await sha256Hex(encoder.encode(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256Hex(encoder.encode('hello'))).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('gives the same digest for the same bytes', async () => {
    const encoder = new TextEncoder()
    expect(await sha256Hex(encoder.encode('a video'))).toBe(await sha256Hex(encoder.encode('a video')))
    expect(await sha256Hex(encoder.encode('a video'))).not.toBe(await sha256Hex(encoder.encode('another video')))
  })
})

describe('sanitizeDriveFileName', () => {
  it('removes path separators so a name cannot leave its folder', () => {
    expect(sanitizeDriveFileName('../../etc/passwd', 'text/plain', 0)).toBe('etcpasswd')
    expect(sanitizeDriveFileName('..\\..\\evil.mp4', 'video/mp4', 0)).toBe('evil.mp4')
    expect(sanitizeDriveFileName('/holiday/clip.mp4', 'video/mp4', 0)).toBe('holidayclip.mp4')
  })

  it('drops control characters and NUL', () => {
    expect(sanitizeDriveFileName('clip\u0000\u0007.mp4', 'video/mp4', 0)).toBe('clip.mp4')
  })

  it('collapses dot-only names and drops leading dots', () => {
    expect(sanitizeDriveFileName('..', 'application/pdf', 2)).toBe('attachment-3.pdf')
    expect(sanitizeDriveFileName('...', 'video/mp4', 0)).toBe('attachment-1.mp4')
    expect(sanitizeDriveFileName('.hidden.txt', 'text/plain', 0)).toBe('hidden.txt')
  })

  it('trims whitespace and falls back when nothing is left', () => {
    expect(sanitizeDriveFileName('  report.pdf  ', 'application/pdf', 0)).toBe('report.pdf')
    expect(sanitizeDriveFileName('   ', 'application/pdf', 1)).toBe('attachment-2.pdf')
    expect(sanitizeDriveFileName(undefined, 'video/mp4', 4)).toBe('attachment-5.mp4')
    expect(sanitizeDriveFileName('', 'application/octet-stream', 0)).toBe('attachment-1.bin')
  })

  it('keeps the extension when it caps a long name at 255 bytes', () => {
    const name = `${'x'.repeat(300)}.mp4`
    const sanitized = sanitizeDriveFileName(name, 'video/mp4', 0)

    expect(new TextEncoder().encode(sanitized).byteLength).toBeLessThanOrEqual(DRIVE_FILE_NAME_MAX_BYTES)
    expect(sanitized.endsWith('.mp4')).toBe(true)
  })

  it('caps a multibyte name without splitting a character', () => {
    const name = `${'ä'.repeat(200)}.pdf`
    const sanitized = sanitizeDriveFileName(name, 'application/pdf', 0)

    expect(sanitized.length).toBeGreaterThan(0)
    expect(new TextEncoder().encode(sanitized).byteLength).toBeLessThanOrEqual(DRIVE_FILE_NAME_MAX_BYTES)
    expect(sanitized).not.toContain('\uFFFD')
    expect(sanitized.endsWith('.pdf')).toBe(true)
  })
})
