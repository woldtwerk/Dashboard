import { z } from 'zod'
import { automationDecisionDefaults } from '../../shared/settings'

export const automationDecisionSchema = z.object({
  provider: z.enum(['laya', 'opencode']),
  service: z.string().trim(),
  model: z.string().trim()
})

export const automationDecisionSettingsDefaults = automationDecisionDefaults
