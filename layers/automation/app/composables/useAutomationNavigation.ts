import type { NavigationMenuChildItem } from '@nuxt/ui'
import { useAutomationReviewCount } from '#layers/automation/app/composables/useAutomationReviewCount'

/** Sidebar submenu of "Automation": its two sections, badged with the reviews Activity waits on */
export function useAutomationNavigation() {
  const { count } = useAutomationReviewCount()

  return computed<NavigationMenuChildItem[]>(() => [
    { label: 'Workflows', icon: 'i-lucide-workflow', to: '/automation' },
    { label: 'Activity', icon: 'i-lucide-activity', to: '/automation/activity', badge: count.value || undefined }
  ])
}
