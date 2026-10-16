import type { NavigationMenuChildItem } from '@nuxt/ui'
import type { Ref } from 'vue'

/** Composable returning the submenu of a navigation entry, e.g. mail folders. Runs in component setup. */
export type NavigationChildrenProvider = () => Ref<NavigationMenuChildItem[]>

const providers = new Map<string, NavigationChildrenProvider>()

/** Register a submenu for the navigation entry with this key (see `dashboard.navigation` in app.config). Call from a plugin. */
export function defineNavigationChildren(key: string, provider: NavigationChildrenProvider) {
  providers.set(key, provider)
}

export function getNavigationChildrenProvider(key: string): NavigationChildrenProvider | undefined {
  return providers.get(key)
}
