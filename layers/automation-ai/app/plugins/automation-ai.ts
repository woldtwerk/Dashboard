import AutomationAiFallback from '../components/automation/AutomationAiFallback.vue'
import { registerDecisionFallback } from '#layers/automation/app/utils/decision-fallbacks'

/**
 * Offers the AI model as a fallback in the workflow builder. The automation layer
 * knows only the registry; the model picker and the model list come from here.
 */
export default defineNuxtPlugin(() => {
  registerDecisionFallback({
    type: 'ai',
    label: 'AI model',
    chainLabel: 'AI',
    icon: 'i-lucide-sparkles',
    description: 'Asks a language model the same question',
    editor: AutomationAiFallback
  })
})
