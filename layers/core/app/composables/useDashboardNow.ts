import { computed, onMounted, onScopeDispose } from 'vue'
import { createSharedComposable, useIntervalFn } from '@vueuse/core'

/**
 * A clock shared by the dashboard: the server captures it once into the Nuxt
 * payload, so SSR and hydration render relative times identically, and the
 * client refreshes it after mount.
 */
function _useDashboardNow() {
  const now = useState('dashboard-now', () => Date.now())

  onMounted(() => {
    now.value = Date.now()
    const { pause } = useIntervalFn(() => {
      now.value = Date.now()
    }, 60_000, { immediate: false })

    onScopeDispose(pause)
  })

  return computed(() => new Date(now.value))
}

export const useDashboardNow = createSharedComposable(_useDashboardNow)
