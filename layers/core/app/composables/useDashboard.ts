import { createSharedComposable } from '@vueuse/core'
import type { NavigationMenuChildItem } from '@nuxt/ui'
import type { DashboardNavigationItem } from '../types/dashboard'

export interface DashboardNavigationEntry extends DashboardNavigationItem {
  key: string
  children?: NavigationMenuChildItem[]
}

const _useDashboard = () => {
  const router = useRouter()
  const appConfig = useAppConfig()
  const { data: services } = useServices()

  const allNavigation = Object.entries<DashboardNavigationItem>(appConfig.dashboard?.navigation ?? {})
    .map(([key, item]) => ({ ...item, key }))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))

  // Submenus contributed by domain layers via defineNavigationChildren()
  const children = Object.fromEntries(allNavigation
    .map(item => [item.key, getNavigationChildrenProvider(item.key)?.()] as const)
    .filter(([, provided]) => provided))

  // Entries contributed by all layers; domain pages only once a service feeds them
  const navigation = computed<DashboardNavigationEntry[]>(() => {
    const domains = new Set(services.value.map(service => service.domain))
    return allNavigation
      .filter(item => !item.domain || domains.has(item.domain))
      .map(item => ({ ...item, children: children[item.key]?.value }))
  })

  defineShortcuts(Object.fromEntries(
    allNavigation
      .filter(item => item.shortcut)
      .map(item => [item.shortcut!, () => router.push(item.to)])
  ))

  return {
    navigation
  }
}

export const useDashboard = createSharedComposable(_useDashboard)
