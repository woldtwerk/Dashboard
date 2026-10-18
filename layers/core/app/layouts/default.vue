<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, NavigationMenuChildItem, NavigationMenuItem } from '@nuxt/ui'
import { refDebounced } from '@vueuse/core'
import { highlightToHtml } from '#layers/core/shared/highlight'
import type { SearchHit, SearchResults } from '#layers/core/shared/types/search'

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

// --- Global search --------------------------------------------------------

const searchTerm = ref('')
const searchResults = ref<SearchResults>({ top: [], groups: [] })
const searching = ref(false)

// The palette's own filtering is off for these groups (`ignoreFilter`): the
// server decides what matches, the term only drives the request.
function paletteItem(hit: SearchHit, icon?: string, suffix?: string, suffixHighlight?: string): CommandPaletteItem {
  const item: CommandPaletteItem = {
    label: hit.title,
    labelHtml: highlightToHtml(hit.titleHighlight ?? hit.title),
    icon,
    suffix,
    suffixHtml: suffixHighlight ? highlightToHtml(suffixHighlight) : undefined,
    to: hit.to,
    // Only search hits carry a match; the badge marks a semantic one
    match: hit.match,
    onSelect: () => { open.value = false }
  }

  if (hit.snippet) {
    item.descriptionHtml = highlightToHtml(hit.snippet)
  }

  return item
}

const domainLabels = computed(() => new Map(searchResults.value.groups.map(group => [group.domain, group.label])))

const topGroup = computed<CommandPaletteGroup | undefined>(() => {
  const hits = searchResults.value.top
  if (!hits.length) {
    return undefined
  }

  return {
    id: 'search-top',
    label: 'Top results',
    ignoreFilter: true,
    // The domain icon and label say where a cross-domain hit came from
    items: hits.map(hit => paletteItem(hit, hit.icon, hit.domainLabel ?? domainLabels.value.get(hit.domain ?? '') ?? hit.subtitle ?? hit.date))
  }
})

const serverGroups = computed<CommandPaletteGroup[]>(() => searchResults.value.groups.map(group => ({
  id: `search-${group.domain}`,
  label: group.label,
  ignoreFilter: true,
  items: group.hits.map(hit => paletteItem(hit, group.icon, hit.subtitle ?? hit.date, hit.subtitleHighlight))
})))

const groups = computed<CommandPaletteGroup[]>(() => [
  ...(topGroup.value ? [topGroup.value] : []),
  ...serverGroups.value,
  {
    id: 'links',
    label: 'Go to',
    items: [
      ...navigation.value.flatMap(({ label, icon, to, children }) => [{ label, icon, to }, ...flatten(children ?? [], label)]),
      { label: 'Customize menu', icon: 'i-lucide-pencil', onSelect: () => { editing.value = true } }
    ] as CommandPaletteItem[]
  }
])

let searchRequest = 0

watch(refDebounced(searchTerm, 250), async (value) => {
  const term = value.trim()
  if (term.length < 2) {
    searchResults.value = { top: [], groups: [] }
    searching.value = false
    return
  }

  const request = ++searchRequest
  searching.value = true

  try {
    const results = await $fetch<SearchResults>('/api/search', { query: { q: term, limit: 5 } })
    if (request === searchRequest) {
      searchResults.value = results
    }
  } catch {
    if (request === searchRequest) {
      searchResults.value = { top: [], groups: [] }
    }
  } finally {
    if (request === searchRequest) {
      searching.value = false
    }
  }
})

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
          <UserMenu :collapsed="collapsed" @customize="editing = true" />
        </template>
      </template>
    </UDashboardSidebar>

    <UDashboardSearch v-model:search-term="searchTerm" :groups="groups" :loading="searching">
      <template #item-trailing="{ item }">
        <UBadge
          v-if="item.match === 'semantic'"
          label="similar"
          color="neutral"
          variant="subtle"
          size="sm"
        />
      </template>
    </UDashboardSearch>

    <slot />
  </UDashboardGroup>
</template>
