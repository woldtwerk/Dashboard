<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import type { TableColumn } from '@nuxt/ui'
import type { LogEntry, LogLevel } from '#layers/core/shared/types/logs'
import type { LogFilters } from '../utils/logs'

useSeoMeta({ title: 'Logs' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const now = useDashboardNow()

const PAGE_SIZE = 100

// --- URL state ---

const filters = computed<LogFilters>(() => logQueryFromRoute(route.query as Record<string, unknown>))

function update(patch: Partial<LogFilters>) {
  router.replace({ query: logQueryToRoute({ ...filters.value, ...patch }) })
}

const { data: services } = await useServices()

const domainItems = computed(() => [...new Set(services.value.map(service => service.domain))].map(domain => ({ label: domain, value: domain })))
const serviceItems = computed(() => [{ label: 'All services', value: LOG_ALL_SERVICES }, ...services.value.map(service => ({ label: service.name, value: service.id }))])
const levelItems = LOG_LEVELS.map(level => ({ label: logLevelMeta(level).label, value: level }))

const domainSelection = computed({
  get: () => filters.value.domains,
  set: (value: string[]) => update({ domains: value })
})
const serviceSelection = computed({
  get: () => filters.value.services[0] ?? LOG_ALL_SERVICES,
  set: (value: string) => update({ services: value === LOG_ALL_SERVICES ? [] : [value] })
})
const levelSelection = computed({
  get: () => filters.value.levels,
  set: (value: LogLevel[]) => update({ levels: value })
})
const live = computed({
  get: () => filters.value.live,
  set: (value: boolean) => update({ live: value })
})

const search = ref(filters.value.q)
watch(() => filters.value.q, (value) => {
  search.value = value
})
const applySearch = useDebounceFn((value: string) => update({ q: value }), 300)
function onSearch(value: string) {
  search.value = value
  applySearch(value)
}

// --- Entries ---

const entries = ref<LogEntry[]>([])
const hasMore = ref(true)
const loadingOlder = ref(false)
const expanded = ref<Record<string, boolean>>({})
const paused = ref(false)
const buffered = ref<LogEntry[]>([])

const pageQuery = computed(() => logFetchQuery(filters.value, { limit: PAGE_SIZE }))
const { data: page } = useFetch<LogEntry[]>('/api/logs' as string, {
  key: 'log-page',
  query: pageQuery,
  lazy: true,
  default: () => []
})

// A filter change clears the list immediately; the refetched page seeds it
watch(filters, () => {
  entries.value = []
  buffered.value = []
  paused.value = false
  expanded.value = {}
})

watch(page, () => {
  entries.value = mergeLogEntries([], page.value, LOG_CAP)
  hasMore.value = page.value.length === PAGE_SIZE
}, { immediate: true })

async function loadOlder() {
  const before = entries.value[entries.value.length - 1]?.id
  if (before == null) {
    return
  }
  loadingOlder.value = true
  try {
    const older = await $fetch<LogEntry[]>('/api/logs' as string, {
      query: logFetchQuery(filters.value, { before, limit: PAGE_SIZE })
    })
    entries.value = mergeLogEntries(entries.value, older, LOG_CAP)
    hasMore.value = older.length === PAGE_SIZE
  } catch {
    toast.add({ title: 'Could not load older entries', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    loadingOlder.value = false
  }
}

// --- Live stream ---

const scrollEl = useTemplateRef<HTMLElement>('scrollEl')

function onEntry(entry: LogEntry) {
  if (paused.value) {
    buffered.value = mergeLogEntries(buffered.value, [entry], LOG_CAP)
    return
  }
  entries.value = mergeLogEntries(entries.value, [entry], LOG_CAP)
}

useLogStream(
  computed(() => logFetchQuery(filters.value)),
  onEntry,
  computed(() => filters.value.live)
)

function onScroll() {
  paused.value = (scrollEl.value?.scrollTop ?? 0) > 8
}

function showNewEntries() {
  entries.value = mergeLogEntries(entries.value, buffered.value, LOG_CAP)
  buffered.value = []
  paused.value = false
  nextTick(() => {
    if (scrollEl.value) {
      scrollEl.value.scrollTop = 0
    }
  })
}

// Client-side text filter over the loaded entries
const visibleEntries = computed(() => entries.value.filter(entry => matchesText(entry, filters.value.q)))

// --- Table ---

const columns: TableColumn<LogEntry>[] = [
  { id: 'expand', header: '' },
  { accessorKey: 'at', header: 'Time' },
  { id: 'level', header: 'Level' },
  { id: 'domain', header: 'Domain' },
  { id: 'service', header: 'Service' },
  { accessorKey: 'message', header: 'Message' }
]

const absoluteTime = (entry: LogEntry) => new Date(entry.at).toLocaleString()
</script>

<template>
  <UDashboardPanel id="logs">
    <template #header>
      <UDashboardNavbar title="Logs">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="Domain">
            <USelectMenu
              v-model="domainSelection"
              :items="domainItems"
              multiple
              value-key="value"
              class="w-44"
              placeholder="All domains"
            />
          </UFormField>

          <UFormField label="Service">
            <USelect
              v-model="serviceSelection"
              :items="serviceItems"
              value-key="value"
              class="w-48"
            />
          </UFormField>

          <UFormField label="Level">
            <USelectMenu
              v-model="levelSelection"
              :items="levelItems"
              multiple
              value-key="value"
              class="w-44"
              placeholder="All levels"
            />
          </UFormField>

          <UFormField label="Search" class="min-w-48 flex-1">
            <UInput
              :model-value="search"
              icon="i-lucide-search"
              placeholder="Filter the loaded entries"
              class="w-full"
              @update:model-value="onSearch"
            />
          </UFormField>

          <UFormField label="Live">
            <USwitch v-model="live" />
          </UFormField>
        </div>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="relative">
        <div
          ref="scrollEl"
          class="max-h-[70vh] overflow-auto rounded-lg border border-default"
          @scroll.passive="onScroll"
        >
          <UTable
            v-model:expanded="expanded"
            :data="visibleEntries"
            :columns="columns"
            :get-row-id="row => String(row.id)"
            :loading="!entries.length && page.length === 0"
            sticky
          >
            <template #expand-cell="{ row }">
              <UButton
                :icon="row.getIsExpanded() ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="row.getIsExpanded() ? 'Collapse entry' : 'Expand entry'"
                :disabled="!row.original.meta"
                @click="row.toggleExpanded()"
              />
            </template>

            <template #at-cell="{ row }">
              <UTooltip :text="absoluteTime(row.original)">
                <span class="text-xs text-muted tabular-nums">{{ formatRelative(row.original.at, now) }}</span>
              </UTooltip>
            </template>

            <template #level-cell="{ row }">
              <LogLevelBadge :level="row.original.level" />
            </template>

            <template #domain-cell="{ row }">
              <DomainBadge :domain="row.original.domain" />
            </template>

            <template #service-cell="{ row }">
              <span class="text-xs text-muted">{{ row.original.service || '—' }}</span>
            </template>

            <template #message-cell="{ row }">
              <span class="text-sm">{{ row.original.message }}</span>
            </template>

            <template #expanded="{ row }">
              <pre class="overflow-auto rounded bg-elevated/50 p-3 text-xs text-muted">{{ JSON.stringify(row.original.meta, null, 2) }}</pre>
            </template>

            <template #empty>
              <UEmpty
                icon="i-lucide-scroll-text"
                title="No log entries"
                description="Nothing matches the current filters yet."
                variant="naked"
                class="py-12"
              />
            </template>
          </UTable>
        </div>

        <div v-if="buffered.length" class="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <UButton
            :label="`${buffered.length} new ${buffered.length === 1 ? 'entry' : 'entries'}`"
            icon="i-lucide-arrow-up"
            class="pointer-events-auto shadow-lg"
            @click="showNewEntries"
          />
        </div>
      </div>

      <div v-if="hasMore" class="mt-4 flex justify-center">
        <UButton
          label="Load older"
          color="neutral"
          variant="soft"
          :loading="loadingOlder"
          @click="loadOlder"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
