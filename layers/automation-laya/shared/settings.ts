/** Providers the automation decision engine can run on */
export type DecisionProvider = 'laya' | 'opencode'

/** Decision models OpenCode serves; their catalog may add more */
export const DECISION_MODELS = [
  'jev-1.14',
  'jev-1.13',
  'jev-1.13-free',
  'gpt-6-luna-decision',
  'gemini-decision-1'
] as const

export interface AutomationDecisionSettings {
  provider: DecisionProvider
  /** The OpenCode AI service id whose key is used; empty for the local engine */
  service: string
  /** The OpenCode decision model; empty for the local engine */
  model: string
}

export const automationDecisionDefaults: AutomationDecisionSettings = {
  provider: 'laya',
  service: '',
  model: 'jev-1.14'
}
