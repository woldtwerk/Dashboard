import { createAiDecisionEngine } from '../automation-ai/engine'

// Registers the AI fallback engine; an automation decision node with an `ai`
// fallback can now ask the configured AI provider when the local engine is unsure.
export default defineNitroPlugin(() => {
  registerFallbackEngine('ai', createAiDecisionEngine)
})
