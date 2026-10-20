import { describe, expect, it } from 'vitest'
import { acceptForPreset, formatAccept, MIME_PRESETS, mimePresetFor } from '../app/utils/drive-save'

describe('mimePresetFor', () => {
  it('matches the file type shortcuts', () => {
    expect(mimePresetFor([])).toBe('all')
    expect(mimePresetFor(['video/*'])).toBe('videos')
    expect(mimePresetFor(['image/*'])).toBe('images')
    expect(mimePresetFor(['application/pdf'])).toBe('pdf')
  })

  it('ignores duplicate and differently ordered globs', () => {
    expect(mimePresetFor(['image/*', 'image/*'])).toBe('images')
  })

  it('calls anything else custom', () => {
    expect(mimePresetFor(['video/*', 'application/pdf'])).toBe('custom')
    expect(mimePresetFor(['text/csv'])).toBe('custom')
  })
})

describe('acceptForPreset', () => {
  it('returns the shortcut list', () => {
    for (const preset of MIME_PRESETS) {
      expect(acceptForPreset(preset.value)).toEqual(preset.accept)
    }
  })

  it('keeps the current list for a custom choice', () => {
    expect(acceptForPreset('custom', ['text/csv'])).toEqual(['text/csv'])
  })

  it('does not share the preset array', () => {
    const accept = acceptForPreset('videos')
    accept.push('text/csv')
    expect(acceptForPreset('videos')).toEqual(['video/*'])
  })
})

describe('formatAccept', () => {
  it('writes the list the free-text field shows', () => {
    expect(formatAccept(['video/*', 'application/pdf'])).toBe('video/*, application/pdf')
    expect(formatAccept(undefined)).toBe('')
  })
})
