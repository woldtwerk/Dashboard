<script setup lang="ts">
import type { CommandPaletteItem, NavigationMenuChildItem, NavigationMenuItem } from '@nuxt/ui'

const { navigation, entries, isDefault, update, reset } = useDashboard()

const open = ref(false)
const editing = ref(false)

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
  items: [
    ...navigation.value.flatMap(({ label, icon, to, children }) => [{ label, icon, to }, ...flatten(children ?? [], label)]),
    { label: 'Customize menu', icon: 'i-lucide-pencil', onSelect: () => { editing.value = true } }
  ] as CommandPaletteItem[]
}])

// The editor works on the current list; names and order are persisted by the composable
function move(from: number, to: number) {
  update(moveEntry(entries.value, from, to))
}

function rename(key: string, label: string) {
  update(entries.value.map(entry => entry.key === key ? { ...entry, label } : entry))
}
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
        <div class="flex w-full" :class="collapsed ? 'flex-col items-center gap-1' : 'items-center gap-2'">
          <UButton
            to="/"
            icon="i-lucide-layout-dashboard"
            :label="collapsed ? undefined : 'Allmight'"
            color="neutral"
            variant="ghost"
            :square="collapsed"
            class="min-w-0"
            :class="[!collapsed && 'flex-1 justify-start py-2']"
          />
          <NotificationBell />
        </div>
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton :collapsed="collapsed" class="bg-transparent ring-default" />

        <NavigationMenuEditor
          v-if="editing"
          :entries="entries"
          @move="move"
          @rename="rename"
        />
        <UNavigationMenu
          v-else
          :collapsed="collapsed"
          :items="links"
          orientation="vertical"
          tooltip
          popover
        />
      </template>

      <template #footer="{ collapsed }">
        <template v-if="editing">
          <div class="flex w-full gap-2">
            <UButton
              icon="i-lucide-rotate-ccw"
              label="Reset to default"
              color="neutral"
              variant="ghost"
              class="min-w-0 flex-1"
              :ui="{ label: 'truncate' }"
              :disabled="isDefault"
              @click="reset"
            />
            <UButton
              icon="i-lucide-check"
              label="Done"
              class="shrink-0"
              @click="editing = false"
            />
          </div>
        </template>
        <template v-else>
          <UTooltip text="Customize menu">
            <UButton
              icon="i-lucide-pencil"
              aria-label="Customize menu"
              color="neutral"
              variant="ghost"
              square
              @click="editing = true"
            />
          </UTooltip>
          <ThemeMenu :collapsed="collapsed" class="flex-1 min-w-0" />
        </template>
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" />

    <slot />
  </UDashboardGroup>
</template>
