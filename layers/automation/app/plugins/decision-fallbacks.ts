import { registerDecisionFallback } from '../utils/decision-fallbacks'

/**
 * The human check is part of the automation layer itself: a decision node can hand
 * an item to the user without any AI provider being set up.
 */
export default defineNuxtPlugin(() => {
  registerDecisionFallback({
    type: 'human',
    label: 'Human check',
    chainLabel: 'Human',
    icon: 'i-lucide-user-check',
    description: 'Pauses the run and asks you to pick the output'
  })
})
