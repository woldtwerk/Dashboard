import { createSharedComposable, useDebounceFn } from '@vueuse/core'
import type { NavigationMenuChildItem } from '@nuxt/ui'
import type { NavigationPreference } from '#layers/core/shared/types/navigation'
import type { DashboardNavigationItem } from '../types/dashboard'
import { applyNavigationPreferences, isDefaultLayout, toPreferences } from '../utils/navigation-preferences'

export interface DashboardNavigationEntry extends DashboardNavigationItem {
  key: string
  children?: NavigationMenuChildItem[]
}

export interface DashboardNavigationListEntry extends DashboardNavigationEntry {
  /** The layer's label; differs from `label` when the user renamed the entry */
  defaultLabel: string
  /** False while the entry's domain has no service yet */
  available: boolean
}

const _useDashboard = () => {
  const router = useRouter()
  const appConfig = useAppConfig()
  const toast = useToast()
  const { data: services } = useServices()

  const { data: preferences } = useFetch<NavigationPreference[]>('/api/navigation/preferences', {
    key: 'navigation-preferences',
    default: () => []
  })

  // Every layer registers here; preferences only reorder and rename the entries
  const defaults = Object.entries<DashboardNavigationItem>(appConfig.dashboard?.navigation ?? {})
    .map(([key, item]) => ({ ...item, key }))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))

  // The editable copy; the fetch result stays the last state the server confirmed
  const overrides = ref<NavigationPreference[]>([])
  watch(preferences, (value) => {
    overrides.value = value
  }, { immediate: true })

  const domains = computed(() => new Set(services.value.map(service => service.domain)))

  // All entries in the user's order, including domains that have no service yet
  const entries = computed<DashboardNavigationListEntry[]>(() => applyNavigationPreferences(defaults, overrides.value)
    .map(entry => ({ ...entry, available: !entry.domain || domains.value.has(entry.domain) })))

  // Submenus contributed by domain layers via defineNavigationChildren()
  const children = Object.fromEntries(defaults
    .map(item => [item.key, getNavigationChildrenProvider(item.key)?.()] as const)
    .filter(([, provided]) => provided))

  // Sidebar entries; a domain page only shows once a service feeds it
  const navigation = computed<DashboardNavigationEntry[]>(() => entries.value
    .filter(entry => entry.available)
    .map(entry => ({ ...entry, children: children[entry.key]?.value })))

  defineShortcuts(Object.fromEntries(defaults
    .filter(item => item.shortcut)
    .map(item => [item.shortcut!, () => router.push(item.to)])))

  // Optimistic: the list updates at once, the server is told once editing settles
  const persist = useDebounceFn(async () => {
    try {
      preferences.value = await $fetch<NavigationPreference[]>('/api/navigation/preferences' as string, {
        method: 'PUT',
        body: toPreferences(entries.value)
      })
    } catch {
      overrides.value = preferences.value
      toast.add({ title: 'Could not save the menu', color: 'error', icon: 'i-lucide-circle-alert' })
    }
  }, 500)

  function update(next: Array<{ key: string, label: string }>) {
    overrides.value = next.map((entry, position) => ({ key: entry.key, label: entry.label, position }))
    persist()
  }

  async function reset() {
    persist.cancel()
    overrides.value = []
    try {
      await $fetch('/api/navigation/preferences', { method: 'DELETE' })
      preferences.value = []
    } catch {
      overrides.value = preferences.value
      toast.add({ title: 'Could not reset the menu', color: 'error', icon: 'i-lucide-circle-alert' })
    }
  }

  const isDefault = computed(() => isDefaultLayout(entries.value, defaults))

  return {
    navigation,
    entries,
    isDefault,
    update,
    reset
  }
}

export const useDashboard = createSharedComposable(_useDashboard)
