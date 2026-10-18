import { describe, expect, it } from 'vitest'
import { driveImageId, parseDriveImageId } from '../shared/drive-image'

describe('driveImageId', () => {
  it('packs a service and a path into one opaque id', () => {
    expect(driveImageId('work', '/my-files/a.png')).toBe('work/my-files/a.png')
  })

  it('adds the leading slash a path without one is missing', () => {
    expect(driveImageId('work', 'my-files/a.png')).toBe('work/my-files/a.png')
  })
})

describe('parseDriveImageId', () => {
  it('splits the service from the path at the first slash', () => {
    expect(parseDriveImageId('work/my-files/a.png')).toEqual({ service: 'work', path: '/my-files/a.png' })
    expect(parseDriveImageId('work/a/b/c.png')).toEqual({ service: 'work', path: '/a/b/c.png' })
  })

  it('keeps an escaped slash inside a name', () => {
    expect(parseDriveImageId('work/my-files/a\\/b.png')).toEqual({ service: 'work', path: '/my-files/a\\/b.png' })
  })

  it('rejects an id without a service or without a path', () => {
    expect(parseDriveImageId('work')).toBeUndefined()
    expect(parseDriveImageId('/my-files/a.png')).toBeUndefined()
    expect(parseDriveImageId('work/')).toBeUndefined()
    expect(parseDriveImageId('')).toBeUndefined()
  })
})
