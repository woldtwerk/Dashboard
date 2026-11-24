import { automationDecisionSchema, automationDecisionSettingsDefaults } from '../laya/settings'
import { createSystemOneEngine } from '../laya/systemone'

// Registers the System One engine and its settings section. The engine picks
// local Laya or OpenCode from Settings → Automation; `available()` hides it
// while neither is set up.
export default defineNitroPlugin(() => {
  registerSettings('automation', automationDecisionSchema, automationDecisionSettingsDefaults)
  registerDecisionEngine('systemone', createSystemOneEngine)
})
