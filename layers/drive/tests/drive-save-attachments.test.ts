import { describe, expect, it } from 'vitest'
import type { DriveImportResult } from '../shared/types/drive'
import type { DriveSettings } from '../shared/types/settings'
import { attachmentSaveToast, rememberedSaveTarget, withSaveTarget } from '../app/utils/drive-save-attachments'

const settings: DriveSettings = {
  saveTargets: {
    'mail-1': { service: 'drive-1', folder: '/my-files/Public' }
  }
}

describe('rememberedSaveTarget', () => {
  it('returns the folder the mail account saved into last', () => {
    expect(rememberedSaveTarget(settings, 'mail-1')).toEqual({ service: 'drive-1', folder: '/my-files/Public' })
    expect(rememberedSaveTarget(settings, 'mail-2')).toBeUndefined()
  })

  it('forgets a target whose drive service is gone', () => {
    expect(rememberedSaveTarget(settings, 'mail-1', ['drive-2'])).toBeUndefined()
  })
})

describe('withSaveTarget', () => {
  it('keeps the other accounts', () => {
    expect(withSaveTarget(settings, 'mail-2', { service: 'drive-2', folder: '/my-files/Private' })).toEqual({
      saveTargets: {
        'mail-1': { service: 'drive-1', folder: '/my-files/Public' },
        'mail-2': { service: 'drive-2', folder: '/my-files/Private' }
      }
    })
  })
})

describe('attachmentSaveToast', () => {
  const result = (overrides: Partial<DriveImportResult>): DriveImportResult => ({
    saved: [],
    skipped: [],
    failed: [],
    ...overrides
  })

  it.each([
    ['some saved', result({ saved: ['/my-files/a'], skipped: [{ name: 'b', reason: 'duplicate' }] }), 'success'],
    ['some saved and some failed', result({ saved: ['/my-files/a'], failed: [{ part: '2', reason: 'nope' }] }), 'warning'],
    ['only failed', result({ failed: [{ part: '2', reason: 'nope' }] }), 'error'],
    ['only skipped', result({ skipped: [{ name: 'b', reason: 'exists' }] }), 'success'],
    ['nothing to do', result({}), 'neutral']
  ])('chooses the %s branch', (_name, value, color) => {
    expect(attachmentSaveToast(value, '/my-files').color).toBe(color)
  })
})
