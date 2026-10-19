import { createSharedComposable } from '@vueuse/core'

/**
 * The number of runs waiting for a human answer, the number the Activity badges
 * show. Lazy: it never blocks a render and never runs on the server, and the
 * shared key means the sidebar submenu and the section header make one request.
 */
export const useAutomationReviewCount = createSharedComposable(() => {
  const { data, refresh, status } = useLazyFetch<{ count: number }>('/api/automation/runs/review-count', {
    key: 'automation-review-count',
    server: false,
    default: () => ({ count: 0 })
  })

  // A run that reaches — or leaves — "review" moves the badge, here or in another tab
  useDomainEvents({ domains: ['automation'] }, () => {
    void refresh()
  })

  const count = computed(() => data.value?.count ?? 0)

  /** Warms the count before the link is clicked, without racing a request already in flight */
  function prefetch() {
    if (status.value === 'idle' || status.value === 'error') {
      void refresh()
    }
  }

  return { count, prefetch }
})
