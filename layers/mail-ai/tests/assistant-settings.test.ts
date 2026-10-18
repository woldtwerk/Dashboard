import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { DomainTool } from '../../core/shared/types/tools'

vi.mock('../../core/server/utils/service-logger', () => ({
  useServiceLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} })
}))

const { registerDomainTools } = await import('../../core/server/utils/domain-tools')
const { registerSettings, parseSettings } = await import('../../core/server/utils/settings')
const { assistantSettingsSchema } = await import('../server/mail-ai/settings')

function fakeTool(name: string, domain: string): DomainTool {
  return {
    name,
    domain,
    description: name,
    input: z.object({}),
    writes: false,
    execute: async () => ({})
  }
}

registerDomainTools([fakeTool('settings_mail_search', 'mail'), fakeTool('settings_contacts_search', 'contacts')])

const section = 'assistant-settings-test'
registerSettings(section, assistantSettingsSchema, { domains: [] })

describe('assistant settings schema', () => {
  it('accepts domains that register tools', () => {
    expect(parseSettings(section, { domains: ['mail', 'contacts'] }).success).toBe(true)
  })

  it('rejects a domain without tools', () => {
    const result = parseSettings(section, { domains: ['mail', 'nowhere'] })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('nowhere')
    }
  })
})
