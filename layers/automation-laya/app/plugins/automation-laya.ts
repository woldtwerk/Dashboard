import { registerAutomationExport } from '#layers/automation/app/utils/automation-exports'

/**
 * Offers the Laya training downloads on the automation activity page. The page
 * only renders the registry, so the automation layer stays Laya-agnostic.
 */
export default defineNuxtPlugin(() => {
  const base = '/api/automation/laya/training-data'

  registerAutomationExport({
    id: 'laya-training-train',
    label: 'Laya training data (train)',
    icon: 'i-lucide-brain',
    to: `${base}?split=train`,
    summary: `${base}?format=summary`
  })

  registerAutomationExport({
    id: 'laya-training-eval',
    label: 'Laya evaluation data (eval)',
    icon: 'i-lucide-flask-conical',
    to: `${base}?split=eval`,
    summary: `${base}?format=summary`
  })

  registerAutomationExport({
    id: 'laya-training-ai',
    label: 'Laya training data (incl. sure AI answers)',
    icon: 'i-lucide-sparkles',
    to: `${base}?split=train&ai=1`,
    summary: `${base}?ai=1&format=summary`
  })
})
