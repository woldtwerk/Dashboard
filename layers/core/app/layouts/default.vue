<script setup lang="ts">
import type { CommandPaletteItem, NavigationMenuChildItem, NavigationMenuItem } from '@nuxt/ui'

const { navigation } = useDashboard()

const open = ref(false)

const closeOnSelect = <T extends NavigationMenuChildItem>(item: T): T => ({
  ...item,
  children: item.children?.map(closeOnSelect),
  onSelect: () => {
    open.value = false
  }
})

const links = computed<NavigationMenuItem[]>(() => navigation.value.map(item => ({
  label: item.label,
  icon: item.icon,
  to: item.to,
  exact: item.to === '/',
  ...item.children?.length
    ? { type: 'trigger' as const, defaultOpen: true, children: item.children.map(closeOnSelect) }
    : {
        onSelect: () => {
          open.value = false
        }
      }
})))

// Flatten submenus so e.g. mail folders are reachable from search
const flatten = (items: NavigationMenuChildItem[], parent?: string): CommandPaletteItem[] => items.flatMap(item => [
  ...item.to ? [{ label: parent ? `${parent} › ${item.label}` : item.label, icon: item.icon, to: item.to }] : [],
  ...flatten(item.children ?? [], parent ? `${parent} › ${item.label}` : item.label)
])

const groups = computed(() => [{
  id: 'links',
  label: 'Go to',
  items: navigation.value.flatMap(({ label, icon, to, children }) => [{ label, icon, to }, ...flatten(children ?? [], label)])
}])
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      id="default"
      v-model:open="open"
      collapsible
      resizable
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <UButton
          to="/"
          icon="i-lucide-layout-dashboard"
          :label="collapsed ? undefined : 'Allmight'"
          color="neutral"
          variant="ghost"
          block
          :square="collapsed"
          :class="[!collapsed && 'justify-start py-2']"
        />
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton :collapsed="collapsed" class="bg-transparent ring-default" />

        <UNavigationMenu
          :collapsed="collapsed"
          :items="links"
          orientation="vertical"
          tooltip
          popover
        />
      </template>

      <template #footer="{ collapsed }">
        <ThemeMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" />

    <slot />
  </UDashboardGroup>
</template>
