import { describe, expect, it } from 'vitest'
import { imageSrcset, imageUrl } from '../app/utils/image-url'

describe('imageUrl', () => {
  it('builds a derivative path with width, fit and version', () => {
    expect(imageUrl('drive', 'work/my-files/a.png', { width: 256, fit: 'fill', v: '1-2' }))
      .toBe('/api/img/drive/work/my-files/a.png?w=256&fit=fill&v=1-2')
  })

  it('adds height and density when given', () => {
    expect(imageUrl('drive', 'work/a.png', { width: 512, height: 384, fit: 'fit', dpr: 2 }))
      .toBe('/api/img/drive/work/a.png?w=512&h=384&fit=fit&dpr=2')
  })

  it('escapes each segment but keeps the separators', () => {
    expect(imageUrl('drive', 'work/my-files/a b#1.png', { width: 64 }))
      .toBe('/api/img/drive/work/my-files/a%20b%231.png?w=64')
  })
})

describe('imageSrcset', () => {
  it('emits a 1x and a 2x candidate for a fixed-size image', () => {
    expect(imageSrcset('drive', 'work/a.png', { width: 256, fit: 'fill', v: '1-2' }))
      .toBe('/api/img/drive/work/a.png?w=256&fit=fill&v=1-2 1x, /api/img/drive/work/a.png?w=512&fit=fill&v=1-2 2x')
  })

  it('emits width descriptors when an explicit list is given', () => {
    expect(imageSrcset('drive', 'work/a.png', { width: 768, fit: 'fit', widths: [384, 768] }))
      .toBe('/api/img/drive/work/a.png?w=384&fit=fit 384w, /api/img/drive/work/a.png?w=768&fit=fit 768w')
  })
})
