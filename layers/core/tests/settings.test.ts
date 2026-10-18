import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { parseSettings, registerSettings, settingsFromStored } from '../server/utils/settings'

const schema = z.object({
  theme: z.enum(['light', 'dark']),
  pageSize: z.number().int().min(1)
})

const defaults = { theme: 'light' as const, pageSize: 25 }
const section = 'test-settings'

registerSettings(section, schema, defaults)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('settingsFromStored', () => {
  it('merges the stored value over the defaults', () => {
    expect(settingsFromStored(section, { pageSize: 50 })).toEqual({ theme: 'light', pageSize: 50 })
  })

  it('returns the defaults when nothing is stored', () => {
    expect(settingsFromStored(section, undefined)).toEqual(defaults)
  })

  it('falls back to the defaults and warns when the stored value is invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(settingsFromStored(section, { theme: 'purple' })).toEqual(defaults)
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain(section)
  })

  it('falls back to the defaults when the stored value is not an object', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(settingsFromStored(section, ['dark', 50])).toEqual(defaults)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('evaluates a defaults function on every read', () => {
    registerSettings('dynamic-defaults', schema, () => ({ theme: 'dark' as const, pageSize: 10 }))

    expect(settingsFromStored('dynamic-defaults', { pageSize: 20 })).toEqual({ theme: 'dark', pageSize: 20 })
  })

  it('merges nested objects key by key over the defaults', () => {
    const nested = z.object({
      categories: z.record(z.string(), z.enum(['off', 'in-app']))
    })
    registerSettings('nested-settings', nested, () => ({ categories: { mail: 'in-app' as const, calendar: 'in-app' as const } }))

    expect(settingsFromStored('nested-settings', { categories: { mail: 'off' } }))
      .toEqual({ categories: { mail: 'off', calendar: 'in-app' } })
  })
})

describe('parseSettings', () => {
  it('accepts a valid section value', () => {
    expect(parseSettings(section, { theme: 'dark', pageSize: 10 }).success).toBe(true)
  })

  it('rejects an invalid section value', () => {
    const result = parseSettings(section, { theme: 'purple', pageSize: 0 })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0)
    }
  })
})
